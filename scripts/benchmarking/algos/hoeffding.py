"""Hoeffding Adaptive Tree (river) — wrapper.

Apprend une régression online f(context) → reward attendu. Le multiplier
appliqué est dérivé du score : plus le reward attendu est élevé, plus on
boost le bid (mapping sigmoïde centré sur la médiane des scores observés).
"""
from __future__ import annotations

from typing import Any

import numpy as np
from river import preprocessing, tree

from .base import BiddingAlgorithm, clamp_multiplier


_FEATURES: list[str] = [
    "day_of_week", "is_weekend", "days_since_start", "is_post_drift",
    "tier_score", "recent_ctr", "recent_visit_rate", "win_rate_7d",
]


def _row_features(context: dict[str, Any]) -> dict[str, float]:
    """Conversion context → dict numérique attendu par river."""
    tier = context.get("tier", "rural")
    tier_score = {"premium_urban": 4.0, "urban": 3.0, "suburban": 2.0, "rural": 1.0}.get(tier, 1.0)
    return {
        "day_of_week": float(context.get("day_of_week", 0)),
        "is_weekend": 1.0 if context.get("is_weekend") else 0.0,
        "days_since_start": float(context.get("days_since_start", 0)),
        "is_post_drift": 1.0 if context.get("is_post_drift") else 0.0,
        "tier_score": tier_score,
        "recent_ctr": float(context.get("recent_ctr", 0.0)),
        "recent_visit_rate": float(context.get("recent_visit_rate", 0.0)),
        "win_rate_7d": float(context.get("win_rate_7d", 0.0)),
    }


class HoeffdingAlgo(BiddingAlgorithm):
    code = "hoeffding_adaptive_tree"

    def __init__(self, config: dict[str, Any]) -> None:
        super().__init__(config)
        self._scaler = preprocessing.StandardScaler()
        self._model = tree.HoeffdingAdaptiveTreeRegressor(
            grace_period=int(config.get("grace_period", 200)),
            max_depth=int(config.get("max_depth", 10)),
            seed=42,
        )
        self._n_samples: int = 0
        self._reward_history: list[float] = []

    def predict(self, context: dict[str, Any]) -> float:
        x = _row_features(context)
        try:
            x = self._scaler.transform_one(x)
            score = float(self._model.predict_one(x))
        except Exception:
            score = 0.0
        # Mapping score → multiplier via tanh autour de la médiane des rewards observés
        if not self._reward_history:
            return 1.0
        med = float(np.median(self._reward_history))
        sd = float(np.std(self._reward_history)) or 1.0
        z = (score - med) / sd
        # tanh ∈ (-1,1), on map à (0.1, 3.0) avec centre à 1.0
        m = 1.0 + 1.5 * float(np.tanh(z))
        return clamp_multiplier(m)

    def learn_one(self, context: dict[str, Any], reward: float) -> None:
        x = _row_features(context)
        self._scaler.learn_one(x)
        x_scaled = self._scaler.transform_one(x)
        self._model.learn_one(x_scaled, float(reward))
        self._n_samples += 1
        self._reward_history.append(float(reward))
        if len(self._reward_history) > 5000:
            self._reward_history = self._reward_history[-5000:]

    def get_state(self) -> dict[str, Any]:
        return {
            "n_samples": self._n_samples,
            "reward_median": float(np.median(self._reward_history)) if self._reward_history else 0.0,
            "reward_std": float(np.std(self._reward_history)) if self._reward_history else 0.0,
            "config": self.config,
            "feature_names": _FEATURES,
        }
