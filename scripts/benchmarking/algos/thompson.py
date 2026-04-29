"""Thompson Sampling (Beta-Bernoulli) — implémentation manuelle.

Discrétise le multiplier en arms (comme LinUCB). Chaque arm a une posterior
Beta(α, β). À la prédiction : tire un échantillon de chaque posterior et
choisit l'arm avec le meilleur tirage.

Le reward continu est binarisé : `1` si reward > médiane glissante, sinon `0`.
"""
from __future__ import annotations

from typing import Any

import numpy as np

from .base import BiddingAlgorithm, clamp_multiplier


_ARMS: list[float] = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]


class ThompsonAlgo(BiddingAlgorithm):
    code = "thompson_sampling"

    def __init__(self, config: dict[str, Any]) -> None:
        super().__init__(config)
        self.arms: list[float] = list(config.get("arms", _ARMS))
        prior_alpha = float(config.get("alpha", 1.0))
        prior_beta = float(config.get("beta", 1.0))
        self._alpha: list[float] = [prior_alpha] * len(self.arms)
        self._beta: list[float] = [prior_beta] * len(self.arms)
        self._reward_window: list[float] = []
        self._last_arm: int | None = None
        self._rng = np.random.default_rng(seed=42)
        self._n: int = 0

    def predict(self, context: dict[str, Any]) -> float:
        # Tirage Beta pour chaque arm, on prend l'arm max
        samples = [
            float(self._rng.beta(max(a, 1e-3), max(b, 1e-3)))
            for a, b in zip(self._alpha, self._beta)
        ]
        best = int(np.argmax(samples))
        self._last_arm = best
        return clamp_multiplier(self.arms[best])

    def learn_one(self, context: dict[str, Any], reward: float) -> None:
        if self._last_arm is None:
            return
        # Binariser le reward : succès si > médiane glissante
        self._reward_window.append(float(reward))
        if len(self._reward_window) > 1000:
            self._reward_window = self._reward_window[-1000:]
        med = float(np.median(self._reward_window))
        success = 1.0 if reward > med else 0.0
        a = self._last_arm
        self._alpha[a] += success
        self._beta[a] += 1.0 - success
        self._n += 1

    def get_state(self) -> dict[str, Any]:
        return {
            "n_samples": self._n,
            "arms": self.arms,
            "alpha": self._alpha,
            "beta": self._beta,
            "arm_means": [
                float(a / max(a + b, 1e-9))
                for a, b in zip(self._alpha, self._beta)
            ],
        }
