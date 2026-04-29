"""LinUCB Contextual Bandit (implémentation manuelle).

Discrétise le multiplier en `K` arms (ex: 0.5, 0.75, 1.0, 1.25, 1.5, 2.0).
Chaque arm maintient un modèle linéaire `theta_a` apprenant E[reward | x, a].
À la prédiction : choisit l'arm qui maximise `theta_a · x + alpha * sqrt(x^T A_a^-1 x)`.

Référence : Li et al., "A Contextual-Bandit Approach to Personalized News
Article Recommendation" (WWW 2010).
"""
from __future__ import annotations

from typing import Any

import numpy as np

from .base import BiddingAlgorithm, clamp_multiplier
from .hoeffding import _row_features


# Arms = candidate multipliers. Discrétisation pragmatique.
_ARMS: list[float] = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]


def _features_vec(context: dict[str, Any]) -> np.ndarray:
    """Conversion context → vecteur numpy de taille fixe."""
    f = _row_features(context)
    # Ordre canonique pour reproductibilité
    return np.array([
        f["day_of_week"], f["is_weekend"], f["days_since_start"],
        f["is_post_drift"], f["tier_score"], f["recent_ctr"],
        f["recent_visit_rate"], f["win_rate_7d"], 1.0,  # bias term
    ], dtype=np.float64)


class LinUcbAlgo(BiddingAlgorithm):
    code = "linucb"

    def __init__(self, config: dict[str, Any]) -> None:
        super().__init__(config)
        self.alpha: float = float(config.get("alpha", 1.0))
        self.arms: list[float] = list(config.get("arms", _ARMS))
        self.d: int = 9  # cf _features_vec
        # Pour chaque arm : A_a (d×d) et b_a (d×1)
        self._A: list[np.ndarray] = [np.eye(self.d) for _ in self.arms]
        self._b: list[np.ndarray] = [np.zeros(self.d) for _ in self.arms]
        self._n: int = 0
        self._last_arm: int | None = None

    def predict(self, context: dict[str, Any]) -> float:
        x = _features_vec(context)
        best_score = -np.inf
        best_arm = len(self.arms) // 2  # default = milieu
        for a, (A, b) in enumerate(zip(self._A, self._b)):
            try:
                A_inv = np.linalg.inv(A)
            except np.linalg.LinAlgError:
                A_inv = np.linalg.pinv(A)
            theta = A_inv @ b
            ucb = float(theta @ x + self.alpha * np.sqrt(max(x @ A_inv @ x, 0.0)))
            if ucb > best_score:
                best_score = ucb
                best_arm = a
        self._last_arm = best_arm
        return clamp_multiplier(self.arms[best_arm])

    def learn_one(self, context: dict[str, Any], reward: float) -> None:
        if self._last_arm is None:
            return
        x = _features_vec(context)
        a = self._last_arm
        self._A[a] += np.outer(x, x)
        self._b[a] += float(reward) * x
        self._n += 1

    def get_state(self) -> dict[str, Any]:
        return {
            "n_samples": self._n,
            "alpha": self.alpha,
            "arms": self.arms,
            "d": self.d,
            # Sérialisation des matrices : on garde juste le compte d'updates par arm
            "arm_pulls": [int(np.trace(A) - self.d) for A in self._A],
        }
