"""GBM online via `river.ensemble.AdaptiveRandomForestRegressor`.

Comme Hoeffding mais en ensemble — souvent plus stable. On garde le même
mapping score→multiplier basé sur la distribution des rewards.
"""
from __future__ import annotations

from typing import Any

import numpy as np
from river import ensemble, preprocessing

from .base import BiddingAlgorithm, clamp_multiplier
from .hoeffding import _row_features


class GbmOnlineAlgo(BiddingAlgorithm):
    code = "gbm_online"

    def __init__(self, config: dict[str, Any]) -> None:
        super().__init__(config)
        self._scaler = preprocessing.StandardScaler()
        self._model = ensemble.AdaptiveRandomForestRegressor(
            n_models=int(config.get("n_models", 10)),
            max_depth=int(config.get("max_depth", 6)),
            seed=42,
        )
        self._reward_history: list[float] = []
        self._n: int = 0

    def predict(self, context: dict[str, Any]) -> float:
        x = _row_features(context)
        try:
            x = self._scaler.transform_one(x)
            score = float(self._model.predict_one(x))
        except Exception:
            score = 0.0
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
        self._n += 1
        self._reward_history.append(float(reward))
        if len(self._reward_history) > 5000:
            self._reward_history = self._reward_history[-5000:]

    def get_state(self) -> dict[str, Any]:
        return {
            "n_samples": self._n,
            "reward_median": float(np.median(self._reward_history)) if self._reward_history else 0.0,
            "reward_std": float(np.std(self._reward_history)) if self._reward_history else 0.0,
            "config": self.config,
        }
