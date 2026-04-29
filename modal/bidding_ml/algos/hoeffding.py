"""Hoeffding Adaptive Tree (river) — wrapper packagé pour Modal.

Différences vs scripts/benchmarking/algos/hoeffding.py :
- `get_state()` inclut le scaler + le modèle river sérialisés via pickle+b64
  pour rebuild complet
- `load_state()` reconstruit le scaler + le modèle depuis le payload

La logique de prédiction (mapping score → multiplier via tanh autour de la
médiane des rewards) est strictement identique à la version benchmark gagnante.
"""
from __future__ import annotations

from typing import Any

import numpy as np
from river import preprocessing, tree

from ..serialization import deserialize_model, serialize_model
from .base import BiddingAlgorithm, clamp_multiplier


_FEATURES: list[str] = [
    "day_of_week", "is_weekend", "days_since_start", "is_post_drift",
    "tier_score", "recent_ctr", "recent_visit_rate", "win_rate_7d",
]


def _row_features(context: dict[str, Any]) -> dict[str, float]:
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
        self.last_score: float | None = None

    def predict(self, context: dict[str, Any]) -> float:
        x = _row_features(context)
        try:
            x_scaled = self._scaler.transform_one(x)
            score = float(self._model.predict_one(x_scaled))
        except Exception:
            score = 0.0
        self.last_score = score
        if not self._reward_history:
            return 1.0
        med = float(np.median(self._reward_history))
        sd = float(np.std(self._reward_history)) or 1.0
        z = (score - med) / sd
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
            "reward_history": self._reward_history[-500:],
            "config": self.config,
            "feature_names": _FEATURES,
            "scaler": serialize_model(self._scaler),
            "model": serialize_model(self._model),
        }

    def load_state(self, parameters: dict[str, Any]) -> None:
        if "scaler" in parameters:
            self._scaler = deserialize_model(parameters["scaler"])
        if "model" in parameters:
            self._model = deserialize_model(parameters["model"])
        self._n_samples = int(parameters.get("n_samples", 0))
        rh = parameters.get("reward_history") or []
        self._reward_history = [float(r) for r in rh]
