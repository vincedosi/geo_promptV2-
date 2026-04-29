"""Persistance des résultats benchmark via le client Supabase HTTPS."""
from __future__ import annotations

import json
from datetime import date, datetime, timezone
from typing import Any

from supabase import Client


MODEL_VERSION_PREFIX = "0.1.0-benchmark-"


def _now_iso() -> str:
    """Timestamp ISO UTC pour les colonnes timestamptz."""
    return datetime.now(timezone.utc).isoformat()


def _jsonable(obj: Any) -> Any:
    """Round-trip via json.dumps pour rendre n'importe quel objet JSON-safe.

    Nécessaire parce que supabase-py sérialise via httpx (json strict), donc
    les date/datetime/numpy types lèvent TypeError sans cette pré-conversion.
    Sémantique équivalente à `json.dumps(..., default=str)`.
    """
    return json.loads(json.dumps(obj, default=str))


def reset_models_for_strategy(client: Client, strategy_id: str) -> None:
    """Marque tous les modèles is_active=true de cette stratégie comme retirés."""
    client.table("adaptive_model_state").update(
        {"is_active": False, "retired_at": _now_iso()}
    ).eq("strategy_id", strategy_id).eq("is_active", True).execute()


def upsert_model_state(
    client: Client,
    strategy_id: str,
    algo_code: str,
    config_schema: dict[str, Any],
    state: dict[str, Any],
    performance_metrics: dict[str, Any],
    train_window: tuple[date, date],
) -> str:
    """Insert (ou remplace) un row adaptive_model_state pour cet algo.

    Stratégie : DELETE de la version précédente (re-run safe), puis INSERT.
    Retourne l'`id` (UUID) du row créé. Le partial unique index
    `idx_ams_one_active` garantit qu'un seul `is_active=true` est possible
    par stratégie (le promote_winner se fait dans un second temps).
    """
    version = f"{MODEL_VERSION_PREFIX}{algo_code}"

    # Cleanup éventuelle row précédente même version (re-run)
    client.table("adaptive_model_state").delete().eq(
        "strategy_id", strategy_id
    ).eq("model_version", version).execute()

    payload = {
        "strategy_id": strategy_id,
        "algorithm_code": algo_code,
        "model_version": version,
        "parameters": _jsonable(state),
        "hyperparameters": _jsonable(config_schema or {}),
        "training_window_start": train_window[0].isoformat(),
        "training_window_end": train_window[1].isoformat(),
        "performance_metrics": _jsonable(performance_metrics),
        "is_active": False,
        "trained_at": _now_iso(),
    }

    response = (
        client.table("adaptive_model_state")
        .insert(payload)
        .execute()
    )
    if not response.data:
        raise RuntimeError(
            f"INSERT adaptive_model_state n'a rien retourné (algo={algo_code})."
        )
    return str(response.data[0]["id"])


def promote_winner(client: Client, strategy_id: str, model_id: str) -> None:
    """Marque le modèle donné comme `is_active=true`."""
    client.table("adaptive_model_state").update(
        {"is_active": True, "promoted_at": _now_iso()}
    ).eq("id", model_id).eq("strategy_id", strategy_id).execute()


def insert_simulation_summary(
    client: Client,
    strategy_id: str,
    name: str,
    parameters: dict[str, Any],
    baseline: dict[str, Any],
    winner: dict[str, Any],
    delta: dict[str, Any],
    by_tier: dict[str, Any],
) -> str:
    """Insert le résumé global du benchmark dans bidding_simulations."""
    now = _now_iso()
    payload = {
        "strategy_id": strategy_id,
        "name": name,
        "parameters": _jsonable(parameters),
        "baseline_metrics": _jsonable(baseline),
        "simulated_metrics": _jsonable(winner),
        "delta": _jsonable(delta),
        "zone_results": _jsonable(by_tier),
        "status": "completed",
        "started_at": now,
        "completed_at": now,
    }
    response = client.table("bidding_simulations").insert(payload).execute()
    if not response.data:
        raise RuntimeError("INSERT bidding_simulations n'a rien retourné.")
    return str(response.data[0]["id"])


def update_strategy_winner(client: Client, strategy_id: str, winner_code: str) -> None:
    """Update bidding_strategies.algorithm_code to the winner if changed."""
    client.table("bidding_strategies").update(
        {"algorithm_code": winner_code}
    ).eq("id", strategy_id).execute()
