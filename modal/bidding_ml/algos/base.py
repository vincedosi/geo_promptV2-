"""Interface commune des algos de bidding (côté Modal).

Différences vs scripts/benchmarking/algos/base.py :
- ajoute `load_state(parameters)` pour reconstruire un modèle depuis
  `adaptive_model_state.parameters` (sérialisation pickle+b64).
- pas de modification de la version benchmarking — c'est une copie versionnée
  côté production.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


MULTIPLIER_MIN: float = 0.1
MULTIPLIER_MAX: float = 3.0


class BiddingAlgorithm(ABC):
    code: str = ""

    def __init__(self, config: dict[str, Any]) -> None:
        self.config: dict[str, Any] = config or {}

    @abstractmethod
    def predict(self, context: dict[str, Any]) -> float: ...

    @abstractmethod
    def learn_one(self, context: dict[str, Any], reward: float) -> None: ...

    @abstractmethod
    def get_state(self) -> dict[str, Any]:
        """Retourne l'état appris (sérialisable JSON pour adaptive_model_state.parameters)."""
        ...

    @abstractmethod
    def load_state(self, parameters: dict[str, Any]) -> None:
        """Reconstruit l'état interne depuis une row adaptive_model_state.parameters."""
        ...


def clamp_multiplier(m: float) -> float:
    if m != m:
        return 1.0
    return max(MULTIPLIER_MIN, min(MULTIPLIER_MAX, float(m)))
