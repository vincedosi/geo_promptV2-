"""Détection de drift statistique sur bidding_daily_state.

Niveau 2 : compare les métriques récentes (window N derniers jours) vs
historique antérieur. Si delta > seuil, génère un drift_event.

Stratégie :
- Pour chaque (strategy_id, postal_code), agrège les daily states sur 2 fenêtres :
  - "before" : jours [lookback_days * 2 ... lookback_days[
  - "after"  : jours [lookback_days ... 0[
- Calcule les moyennes : CPL, CTR, conversion_rate
- Si abs(delta_pct) > seuil → drift event

Seuils par défaut (tunables) :
- CPL : ±30% → severity=medium, ±50% → severity=high
- CTR : ±25% → medium, ±50% → high
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from supabase import Client

from .data_loader import paginate_select


CPL_THRESHOLD_MEDIUM = 0.30
CPL_THRESHOLD_HIGH = 0.50
CTR_THRESHOLD_MEDIUM = 0.25
CTR_THRESHOLD_HIGH = 0.50


def _safe_div(a: float, b: float) -> float:
    return float(a) / float(b) if b else 0.0


def _aggregate_window(rows: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
    """Agrège les daily states par postal_code → {cpl, ctr, n_days}."""
    by_pc: dict[str, dict[str, float]] = defaultdict(
        lambda: {"impressions": 0.0, "clicks": 0.0, "spend": 0.0, "conversions": 0.0, "n": 0}
    )
    for r in rows:
        pc = r["postal_code"]
        by_pc[pc]["impressions"] += float(r.get("impressions") or 0)
        by_pc[pc]["clicks"] += float(r.get("clicks") or 0)
        by_pc[pc]["spend"] += float(r.get("spend") or 0)
        by_pc[pc]["conversions"] += float(r.get("conversions") or 0)
        by_pc[pc]["n"] += 1
    out = {}
    for pc, agg in by_pc.items():
        out[pc] = {
            "cpl": _safe_div(agg["spend"], agg["conversions"]),
            "ctr": _safe_div(agg["clicks"], agg["impressions"]),
            "n_days": agg["n"],
            "spend": agg["spend"],
            "conversions": agg["conversions"],
        }
    return out


def _classify(delta_pct: float, t_med: float, t_high: float) -> str | None:
    a = abs(delta_pct)
    if a >= t_high:
        return "high"
    if a >= t_med:
        return "medium"
    return None


def scan_for_drifts(
    client: Client,
    strategy_id: str,
    lookback_days: int = 7,
    min_n_per_window: int = 2,
) -> list[dict[str, Any]]:
    """Scanne 2 fenêtres successives de N jours et retourne les drifts détectés.

    Retourne une liste de dicts prêts à insérer dans bidding_drift_events.
    Si la fenêtre "before" n'a pas assez de données par CP, on skip ce CP.
    """
    today = date.today()
    after_start = today - timedelta(days=lookback_days)
    before_start = after_start - timedelta(days=lookback_days)

    rows = paginate_select(
        client.table("bidding_daily_state")
        .select("strategy_id,postal_code,country_code,date,impressions,clicks,conversions,spend")
        .eq("strategy_id", strategy_id)
        .gte("date", before_start.isoformat())
    )

    before_rows = [r for r in rows if before_start.isoformat() <= r["date"] < after_start.isoformat()]
    after_rows = [r for r in rows if r["date"] >= after_start.isoformat()]
    before_agg = _aggregate_window(before_rows)
    after_agg = _aggregate_window(after_rows)

    drifts: list[dict[str, Any]] = []
    for pc, before in before_agg.items():
        after = after_agg.get(pc)
        if after is None:
            continue
        if before["n_days"] < min_n_per_window or after["n_days"] < min_n_per_window:
            continue

        for metric_name, before_val, after_val, t_med, t_high in [
            ("cpl", before["cpl"], after["cpl"], CPL_THRESHOLD_MEDIUM, CPL_THRESHOLD_HIGH),
            ("ctr", before["ctr"], after["ctr"], CTR_THRESHOLD_MEDIUM, CTR_THRESHOLD_HIGH),
        ]:
            if before_val == 0 and after_val == 0:
                continue
            base = before_val if before_val > 0 else 1e-9
            delta_pct = (after_val - base) / base
            severity = _classify(delta_pct, t_med, t_high)
            if severity is None:
                continue
            drifts.append({
                "strategy_id": strategy_id,
                "postal_code": pc,
                "drift_type": f"performance_{metric_name}",
                "severity": severity,
                "metric_before": {metric_name: before_val, "window_days": before["n_days"]},
                "metric_after": {metric_name: after_val, "window_days": after["n_days"]},
                "delta": float(delta_pct),
                "threshold": float(t_med if severity == "medium" else t_high),
                "description": (
                    f"{metric_name.upper()} drift on {pc}: "
                    f"{before_val:.4f} → {after_val:.4f} "
                    f"({delta_pct * 100:+.1f}%, sev={severity})"
                ),
                "auto_action": "alert",
            })
    return drifts
