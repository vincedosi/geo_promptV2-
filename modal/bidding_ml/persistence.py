"""Persistance multi-mode (auto / suggest / monitor_only) côté Modal.

Toutes les écritures passent par supabase-py (HTTPS). Le service_role_key
bypass RLS donc les RLS policies sont uniquement protectrices côté frontend.
"""
from __future__ import annotations

from datetime import date as date_cls
from typing import Any

from supabase import Client


# ─── Mode auto : push direct vers bidding_zone_configs ──────────────────────

def write_configs_directly(
    client: Client, strategy_id: str, predictions: list[dict[str, Any]]
) -> int:
    """UPSERT dans bidding_zone_configs (UNIQUE strategy_id, postal_code, country_code)."""
    if not predictions:
        return 0
    rows = [
        {
            "strategy_id": strategy_id,
            "postal_code": p["postal_code"],
            "country_code": p.get("country_code", "FR"),
            "bid_multiplier": float(p["multiplier"]),
            "is_active": True,
        }
        for p in predictions
    ]
    resp = (
        client.table("bidding_zone_configs")
        .upsert(rows, on_conflict="strategy_id,postal_code,country_code")
        .execute()
    )
    return len(resp.data or rows)


# ─── Mode suggest : INSERT proposals ────────────────────────────────────────

def write_proposals(
    client: Client,
    strategy_id: str,
    predictions: list[dict[str, Any]],
    model_version: str,
    proposed_by: str = "hoeffding",
) -> int:
    """INSERT dans bidding_zone_config_proposals (status='pending', expire 7j)."""
    if not predictions:
        return 0
    rows = [
        {
            "strategy_id": strategy_id,
            "postal_code": p["postal_code"],
            "country_code": p.get("country_code", "FR"),
            "proposed_bid_multiplier": float(p["multiplier"]),
            "reasoning": {
                "model_score": p.get("model_score"),
                "model_version": model_version,
                "context": p.get("context"),
                "drift_context": p.get("drift_context"),
            },
            "proposed_by": proposed_by,
            "status": "pending",
        }
        for p in predictions
    ]
    resp = client.table("bidding_zone_config_proposals").insert(rows).execute()
    return len(resp.data or rows)


# ─── Mode monitor_only : log dans bidding_daily_state ───────────────────────

def log_predictions_only(
    client: Client, strategy_id: str, predictions: list[dict[str, Any]]
) -> int:
    """UPSERT dans bidding_daily_state (UNIQUE strategy_id, postal_code, country_code, date).

    Mode monitoring : on enregistre la décision du modèle sans modifier les bids.
    `applied_bid_multiplier` est stocké pour audit. `impressions/clicks/spend` à 0
    car aucune campagne n'a tourné avec ce multiplier (mode monitor).
    """
    if not predictions:
        return 0
    today = date_cls.today().isoformat()
    rows = [
        {
            "strategy_id": strategy_id,
            "postal_code": p["postal_code"],
            "country_code": p.get("country_code", "FR"),
            "date": today,
            "applied_bid_multiplier": float(p["multiplier"]),
            "impressions": 0,
            "clicks": 0,
            "conversions": 0,
            "spend": 0,
            "model_decision": {
                "model_score": p.get("model_score"),
                "context": p.get("context"),
                "mode": "monitor_only",
            },
        }
        for p in predictions
    ]
    resp = (
        client.table("bidding_daily_state")
        .upsert(rows, on_conflict="strategy_id,postal_code,country_code,date")
        .execute()
    )
    return len(resp.data or rows)


# ─── Train : INSERT new adaptive_model_state + désactive l'ancienne ─────────

def insert_new_model_state(
    client: Client,
    strategy_id: str,
    algorithm_code: str,
    parameters: dict[str, Any],
    hyperparameters: dict[str, Any],
    performance_metrics: dict[str, Any],
    training_window: tuple[date_cls, date_cls],
    new_version: str,
    activate: bool = True,
) -> str:
    """INSERT row + (optionnel) promote en is_active=true.

    Le partial unique index `idx_ams_one_active` garantit qu'une seule row
    is_active=true par strategy_id. On UPDATE l'ancienne en first.
    """
    if activate:
        client.table("adaptive_model_state").update(
            {"is_active": False, "retired_at": "now()"}
        ).eq("strategy_id", strategy_id).eq("is_active", True).execute()

    payload = {
        "strategy_id": strategy_id,
        "algorithm_code": algorithm_code,
        "model_version": new_version,
        "parameters": parameters,
        "hyperparameters": hyperparameters,
        "training_window_start": training_window[0].isoformat(),
        "training_window_end": training_window[1].isoformat(),
        "performance_metrics": performance_metrics,
        "is_active": activate,
    }
    if activate:
        payload["promoted_at"] = "now()"

    resp = client.table("adaptive_model_state").insert(payload).execute()
    if not resp.data:
        raise RuntimeError("INSERT adaptive_model_state retourné vide")
    return str(resp.data[0]["id"])


# ─── Approve workflow (utilisé par /api/bidding/proposals/[id]/approve) ─────

def apply_proposal_to_config(
    client: Client, proposal_id: str
) -> dict[str, Any]:
    """Transfère une proposal pending vers bidding_zone_configs (UPSERT).

    Idempotent côté postal_code : UPSERT remplace une éventuelle config existante.
    """
    prop_resp = (
        client.table("bidding_zone_config_proposals")
        .select("*")
        .eq("id", proposal_id)
        .limit(1)
        .execute()
    )
    if not prop_resp.data:
        raise ValueError(f"Proposal {proposal_id} introuvable")
    prop = prop_resp.data[0]
    if prop["status"] != "pending" and prop["status"] != "approved":
        raise ValueError(
            f"Proposal {proposal_id} en status={prop['status']} (attendu: pending|approved)"
        )

    cfg_payload = {
        "strategy_id": prop["strategy_id"],
        "postal_code": prop["postal_code"],
        "country_code": prop.get("country_code", "FR"),
        "bid_multiplier": float(prop["proposed_bid_multiplier"]),
        "is_active": True,
    }
    if prop.get("proposed_floor_bid") is not None:
        cfg_payload["floor_bid"] = float(prop["proposed_floor_bid"])
    if prop.get("proposed_ceiling_bid") is not None:
        cfg_payload["ceiling_bid"] = float(prop["proposed_ceiling_bid"])
    if prop.get("proposed_target_metrics"):
        cfg_payload["target_metrics"] = prop["proposed_target_metrics"]
    if prop.get("proposed_constraints"):
        cfg_payload["constraints"] = prop["proposed_constraints"]

    cfg_resp = (
        client.table("bidding_zone_configs")
        .upsert(cfg_payload, on_conflict="strategy_id,postal_code,country_code")
        .execute()
    )
    config_id = cfg_resp.data[0]["id"] if cfg_resp.data else None

    client.table("bidding_zone_config_proposals").update(
        {
            "status": "applied",
            "applied_at": "now()",
            "applied_to_config_id": config_id,
        }
    ).eq("id", proposal_id).execute()

    return {"proposal_id": proposal_id, "config_id": config_id}
