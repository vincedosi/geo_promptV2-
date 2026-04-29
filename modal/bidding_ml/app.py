"""GEOMATIK Bidding ML — service Modal.

Expose 3 endpoints HTTPS pour l'algo actif (Hoeffding Adaptive Tree
aujourd'hui) :
- POST /predict       — génère les bid_multipliers selon execution_mode
- POST /train         — ré-entraîne le modèle sur les N derniers jours
- POST /detect-drift  — scanne les drifts et insère dans bidding_drift_events

L'algo concret est résolu dynamiquement depuis adaptive_model_state.is_active
via algos/registry.py — aucun nom d'algo hardcodé ici.
"""
from __future__ import annotations

import time
from datetime import date, timedelta
from typing import Any

import modal


app = modal.App("bidding-ml")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "river>=0.21",
        "supabase>=2.10.0",
        "pandas>=2.0",
        "numpy>=1.24",
        "pydantic>=2.0",
    )
    .add_local_dir(
        local_path="modal/bidding_ml",
        remote_path="/root/bidding_ml",
    )
)

supabase_secret = modal.Secret.from_name("geomatik-supabase")


# ─── Helpers communs (importés au runtime à l'intérieur des handlers) ───────

DAY0 = date(2026, 3, 1)


def _build_context(row: dict[str, Any]) -> dict[str, Any]:
    """Conversion row dsp_campaign_data → context features pour les algos."""
    metrics = row.get("metrics") or {}
    d = row["date"]
    if isinstance(d, str):
        from datetime import datetime as _dt
        d = _dt.fromisoformat(d).date()
    impressions = int(row.get("impressions") or 0)
    clicks = int(row.get("clicks") or 0)
    visits = int(metrics.get("visits") or 0) if isinstance(metrics, dict) else 0
    bid_won = int(metrics.get("bid_won") or 0) if isinstance(metrics, dict) else 0
    bid_requests = int(metrics.get("bid_requests") or 0) if isinstance(metrics, dict) else 0
    tier = (metrics.get("tier") if isinstance(metrics, dict) else None) or "rural"
    return {
        "postal_code": row["postal_code"],
        "date": d.isoformat(),
        "day_of_week": d.weekday(),
        "is_weekend": d.weekday() >= 5,
        "days_since_start": (d - DAY0).days,
        "is_post_drift": d >= date(2026, 3, 16),
        "tier": tier,
        "recent_ctr": float(clicks) / max(impressions, 1),
        "recent_visit_rate": float(visits) / max(impressions, 1),
        "win_rate_7d": float(bid_won) / max(bid_requests, 1) if bid_requests else 0.0,
    }


def _row_reward(row: dict[str, Any]) -> float:
    """Reward = leads - (1/12.5) * spend (cohérent avec le benchmark A4.2)."""
    metrics = row.get("metrics") or {}
    leads = int(metrics.get("leads") or 0) if isinstance(metrics, dict) else 0
    spend = float(row.get("spend") or 0)
    return float(leads) - (1.0 / 12.5) * spend


# ─── Endpoint /predict ──────────────────────────────────────────────────────

@app.function(image=image, secrets=[supabase_secret], timeout=120)
@modal.fastapi_endpoint(method="POST")
def predict(request_data: dict) -> dict:
    import sys
    sys.path.insert(0, "/root")
    from bidding_ml.data_loader import (  # noqa: E402
        get_client, load_strategy, load_active_model, load_recent_data,
    )
    from bidding_ml.algos.registry import load_algo_from_state  # noqa: E402
    from bidding_ml.algos.base import clamp_multiplier  # noqa: E402
    from bidding_ml.persistence import (  # noqa: E402
        write_configs_directly, write_proposals, log_predictions_only,
    )

    t0 = time.time()
    strategy_id = request_data.get("strategy_id")
    if not strategy_id:
        return {"error": "strategy_id manquant", "status": 400}

    client = get_client()
    strategy = load_strategy(client, strategy_id)
    if not strategy:
        return {"error": f"Strategy {strategy_id} not found", "status": 404}

    model_state = load_active_model(client, strategy_id)
    if not model_state:
        return {
            "error": f"Aucun modèle actif pour strategy {strategy_id}. Lance /train d'abord.",
            "status": 400,
        }

    algo = load_algo_from_state(model_state)

    days = int(request_data.get("days", 7))
    rows = load_recent_data(client, strategy["campaign_id"], days=days)
    if not rows:
        return {
            "strategy_id": strategy_id,
            "mode": strategy["execution_mode"],
            "n_predictions": 0,
            "n_persisted": 0,
            "duration_ms": int((time.time() - t0) * 1000),
            "warning": "Aucune donnée récente",
        }

    # Une prédiction par CP unique (on prend la dernière row par CP).
    by_cp: dict[str, dict[str, Any]] = {}
    for r in rows:
        by_cp[r["postal_code"]] = r

    predictions: list[dict[str, Any]] = []
    for pc, row in by_cp.items():
        ctx = _build_context(row)
        m = clamp_multiplier(algo.predict(ctx))
        predictions.append({
            "postal_code": pc,
            "country_code": row.get("country") or "FR",
            "multiplier": m,
            "context": ctx,
            "model_score": getattr(algo, "last_score", None),
        })

    mode = strategy["execution_mode"]
    if mode == "auto":
        n_persisted = write_configs_directly(client, strategy_id, predictions)
    elif mode == "suggest":
        n_persisted = write_proposals(
            client, strategy_id, predictions, model_state["model_version"]
        )
    elif mode == "monitor_only":
        n_persisted = log_predictions_only(client, strategy_id, predictions)
    else:
        return {"error": f"Unknown execution_mode: {mode}", "status": 400}

    return {
        "strategy_id": strategy_id,
        "mode": mode,
        "n_predictions": len(predictions),
        "n_persisted": n_persisted,
        "duration_ms": int((time.time() - t0) * 1000),
    }


# ─── Endpoint /train ────────────────────────────────────────────────────────

@app.function(image=image, secrets=[supabase_secret], timeout=600)
@modal.fastapi_endpoint(method="POST")
def train(request_data: dict) -> dict:
    import sys
    sys.path.insert(0, "/root")
    from bidding_ml.data_loader import (  # noqa: E402
        get_client, load_strategy, load_algorithm_meta, load_training_data,
    )
    from bidding_ml.algos.registry import instantiate_fresh  # noqa: E402
    from bidding_ml.persistence import insert_new_model_state  # noqa: E402

    t0 = time.time()
    strategy_id = request_data.get("strategy_id")
    if not strategy_id:
        return {"error": "strategy_id manquant", "status": 400}

    days_back = int(request_data.get("days_back", 30))

    client = get_client()
    strategy = load_strategy(client, strategy_id)
    if not strategy:
        return {"error": f"Strategy {strategy_id} not found", "status": 404}

    algo_meta = load_algorithm_meta(client, strategy["algorithm_code"])
    if not algo_meta or not algo_meta.get("is_enabled"):
        return {
            "error": f"Algo '{strategy['algorithm_code']}' désactivé ou inconnu en base.",
            "status": 400,
        }

    rows = load_training_data(client, strategy["campaign_id"], days_back=days_back)
    if not rows:
        return {"error": "Aucune donnée d'entraînement disponible", "status": 400}

    algo = instantiate_fresh(strategy["algorithm_code"], algo_meta.get("config_schema") or {})
    train_start = date.today()
    train_end = date(2000, 1, 1)
    n_train = 0
    for row in rows:
        ctx = _build_context(row)
        algo.predict(ctx)
        algo.learn_one(ctx, _row_reward(row))
        n_train += 1
        d = row["date"]
        if isinstance(d, str):
            from datetime import datetime as _dt
            d = _dt.fromisoformat(d).date()
        if d < train_start:
            train_start = d
        if d > train_end:
            train_end = d

    state = algo.get_state()
    new_version = f"0.2.0-modal-{int(t0)}"
    perf = {
        "n_train_samples": n_train,
        "training_window_days": days_back,
        "trained_via": "modal",
    }
    model_id = insert_new_model_state(
        client=client,
        strategy_id=strategy_id,
        algorithm_code=strategy["algorithm_code"],
        parameters=state,
        hyperparameters=algo_meta.get("config_schema") or {},
        performance_metrics=perf,
        training_window=(train_start, train_end),
        new_version=new_version,
        activate=True,
    )

    return {
        "strategy_id": strategy_id,
        "model_id": model_id,
        "model_version": new_version,
        "n_train_samples": n_train,
        "training_window": [train_start.isoformat(), train_end.isoformat()],
        "duration_ms": int((time.time() - t0) * 1000),
    }


# ─── Endpoint /detect-drift ─────────────────────────────────────────────────

@app.function(image=image, secrets=[supabase_secret], timeout=180)
@modal.fastapi_endpoint(method="POST")
def detect_drift(request_data: dict) -> dict:
    import sys
    sys.path.insert(0, "/root")
    from bidding_ml.data_loader import get_client  # noqa: E402
    from bidding_ml.drift_detection import scan_for_drifts  # noqa: E402

    t0 = time.time()
    strategy_id = request_data.get("strategy_id")
    if not strategy_id:
        return {"error": "strategy_id manquant", "status": 400}
    lookback = int(request_data.get("lookback_days", 7))

    client = get_client()
    drifts = scan_for_drifts(client, strategy_id, lookback_days=lookback)

    n_inserted = 0
    if drifts:
        resp = client.table("bidding_drift_events").insert(drifts).execute()
        n_inserted = len(resp.data or drifts)

    return {
        "strategy_id": strategy_id,
        "n_drifts_detected": len(drifts),
        "n_inserted": n_inserted,
        "lookback_days": lookback,
        "duration_ms": int((time.time() - t0) * 1000),
    }
