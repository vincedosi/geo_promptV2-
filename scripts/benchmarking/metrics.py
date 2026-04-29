"""Métriques + simulation linéaire.

Modèle de simulation : `leads_sim = leads_observed * multiplier`,
            `spend_sim = spend_observed * multiplier`.

Limites de ce modèle :
- linéaire (pas de saturation), volontairement simple pour départager qualitativement
- ne capture pas l'effet réseau (un autre annonceur perd ce que tu gagnes)
- pas de coût d'opportunité

Suffisant pour ce benchmark — un modèle plus réaliste est prévu pour A4.3
(courbe de réponse non-linéaire avec données market-level).
"""
from __future__ import annotations

import time
from datetime import date
from typing import Any

import numpy as np
import pandas as pd

from algos.base import BiddingAlgorithm, clamp_multiplier
from data_loader import build_context


# Reward model : `leads - LAMBDA * spend`.
# LAMBDA = 1 / kpi_target (12.5 € → 1 lead vaut 1 unit de pénalité spend).
LAMBDA: float = 1.0 / 12.5
DAY0: date = date(2026, 3, 1)
DRIFT_DATE: date = date(2026, 3, 16)


def _row_reward(row: pd.Series) -> float:
    """Reward par observation."""
    return float(row["leads"]) - LAMBDA * float(row["spend"])


def train_algo(algo: BiddingAlgorithm, train_df: pd.DataFrame) -> float:
    """Lance les `learn_one` sur le train set. Retourne durée en ms."""
    t0 = time.perf_counter()
    for _, row in train_df.iterrows():
        ctx = build_context(row, DAY0)
        # En train, on observe le multiplier appliqué (ici 1.0 par défaut sur
        # le legacy "no algo") et on apprend la relation context → reward.
        # Pour les bandits LinUCB / Thompson, on appelle predict() pour
        # qu'un arm soit sélectionné, puis learn_one() update cet arm.
        algo.predict(ctx)
        algo.learn_one(ctx, _row_reward(row))
    return (time.perf_counter() - t0) * 1000.0


def evaluate_on_test(
    algo: BiddingAlgorithm, test_df: pd.DataFrame
) -> tuple[dict[str, Any], float]:
    """Simule l'algo sur le test set + apprentissage online.

    Retourne :
    - dict métriques (leads_real, leads_sim, lift_pct, cpl_real, cpl_sim,
      cpl_delta_eur, drift_robustness, latency_predict_ms_mean,
      multiplier_mean, multiplier_std, by_tier)
    - durée totale en ms
    """
    t0 = time.perf_counter()
    leads_sim_total: float = 0.0
    spend_sim_total: float = 0.0
    multipliers: list[float] = []
    predict_times: list[float] = []
    by_tier: dict[str, dict[str, float]] = {}
    pre_drift = {"leads_real": 0.0, "leads_sim": 0.0}
    post_drift = {"leads_real": 0.0, "leads_sim": 0.0}

    for _, row in test_df.iterrows():
        ctx = build_context(row, DAY0)
        tp0 = time.perf_counter()
        m = algo.predict(ctx)
        predict_times.append((time.perf_counter() - tp0) * 1000.0)
        m = clamp_multiplier(m)
        multipliers.append(m)

        leads_real = float(row["leads"])
        spend_real = float(row["spend"])
        leads_sim = leads_real * m
        spend_sim = spend_real * m

        leads_sim_total += leads_sim
        spend_sim_total += spend_sim

        tier = str(row["tier"])
        d = by_tier.setdefault(tier, {"leads_real": 0.0, "leads_sim": 0.0, "spend_real": 0.0, "spend_sim": 0.0})
        d["leads_real"] += leads_real
        d["leads_sim"] += leads_sim
        d["spend_real"] += spend_real
        d["spend_sim"] += spend_sim

        if row["date"] >= DRIFT_DATE:
            post_drift["leads_real"] += leads_real
            post_drift["leads_sim"] += leads_sim
        else:
            pre_drift["leads_real"] += leads_real
            pre_drift["leads_sim"] += leads_sim

        # Apprentissage online sur le test : l'algo continue d'apprendre
        algo.learn_one(ctx, _row_reward(row))

    leads_real_total = float(test_df["leads"].sum())
    spend_real_total = float(test_df["spend"].sum())
    cpl_real = spend_real_total / max(leads_real_total, 1.0)
    cpl_sim = spend_sim_total / max(leads_sim_total, 1.0)

    drift_robustness = (
        (post_drift["leads_sim"] - post_drift["leads_real"])
        / max(post_drift["leads_real"], 1.0)
        * 100.0
    )

    metrics = {
        "leads_real": leads_real_total,
        "leads_sim": leads_sim_total,
        "lift_pct": (leads_sim_total - leads_real_total) / max(leads_real_total, 1.0) * 100.0,
        "spend_real": spend_real_total,
        "spend_sim": spend_sim_total,
        "cpl_real": cpl_real,
        "cpl_sim": cpl_sim,
        "cpl_delta_eur": cpl_sim - cpl_real,
        "drift_robustness_pct": drift_robustness,
        "pre_drift": pre_drift,
        "post_drift": post_drift,
        "multiplier_mean": float(np.mean(multipliers)) if multipliers else 1.0,
        "multiplier_std": float(np.std(multipliers)) if multipliers else 0.0,
        "latency_predict_ms_mean": float(np.mean(predict_times)) if predict_times else 0.0,
        "n_predictions": len(multipliers),
        "by_tier": by_tier,
    }
    duration_ms = (time.perf_counter() - t0) * 1000.0
    return metrics, duration_ms


def baseline_metrics(test_df: pd.DataFrame) -> dict[str, Any]:
    """Référence multiplier=1.0 partout — par construction lift=0 et CPL réel."""
    leads = float(test_df["leads"].sum())
    spend = float(test_df["spend"].sum())
    return {
        "leads": leads,
        "spend": spend,
        "cpl_eur": spend / max(leads, 1.0),
        "lift_pct": 0.0,
    }


def lift_curve_daily(algo: BiddingAlgorithm, test_df: pd.DataFrame) -> pd.DataFrame:
    """Reconstruit la courbe lift cumulée jour-par-jour pour les plots.

    NB : on utilise les multipliers observés via predict() (sans re-learn,
    on assume que le state interne reflète déjà la trajectoire).
    """
    out: list[dict[str, Any]] = []
    leads_real_cum = 0.0
    leads_sim_cum = 0.0
    for d, group in test_df.groupby("date"):
        for _, row in group.iterrows():
            ctx = build_context(row, DAY0)
            m = clamp_multiplier(algo.predict(ctx))
            leads_real_cum += float(row["leads"])
            leads_sim_cum += float(row["leads"]) * m
        lift = (leads_sim_cum - leads_real_cum) / max(leads_real_cum, 1.0) * 100.0
        out.append({"date": d, "leads_real_cum": leads_real_cum, "leads_sim_cum": leads_sim_cum, "lift_pct": lift})
    return pd.DataFrame(out)
