"""Baseline aléatoire — multiplier uniforme dans [min, max] config.

Sert de plancher de comparaison pour les autres algos. Tout algo qui ne bat
pas la baseline n'apporte rien.
"""
from __future__ import annotations

from typing import Any

import numpy as np

from .base import BiddingAlgorithm, clamp_multiplier


class BaselineRandomAlgo(BiddingAlgorithm):
    code = "baseline_random"

    def __init__(self, config: dict[str, Any]) -> None:
        super().__init__(config)
        self.lo: float = float(config.get("min_multiplier", 0.5))
        self.hi: float = float(config.get("max_multiplier", 1.5))
        self._rng = np.random.default_rng(seed=42)
        self._n: int = 0

    def predict(self, context: dict[str, Any]) -> float:
        m = float(self._rng.uniform(self.lo, self.hi))
        return clamp_multiplier(m)

    def learn_one(self, context: dict[str, Any], reward: float) -> None:
        self._n += 1  # pas d'apprentissage

    def get_state(self) -> dict[str, Any]:
        return {"n_samples": self._n, "min": self.lo, "max": self.hi}
