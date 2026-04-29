"""Interface commune pour tous les algos benchmarkés.

Le contrat :
- chaque algo prédit un `bid_multiplier` (float) pour un contexte (CP, jour, features)
- chaque algo apprend de la perf observée via `learn_one(context, reward)`
- chaque algo expose son état appris pour persistance via `get_state()`

L'orchestrateur ne sait rien des internals : il itère sur n'importe quels
algos respectant cette interface. Ajouter un algo = créer un fichier dans
`algos/` qui implémente `BiddingAlgorithm` + INSERT en base dans
`bidding_algorithms` (rien à modifier dans l'orchestrateur).
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


# Borne globale du multiplier appliqué — évite les bids délirants.
MULTIPLIER_MIN: float = 0.1
MULTIPLIER_MAX: float = 3.0


class BiddingAlgorithm(ABC):
    """Interface des algos. Chaque sous-classe set son `code` matchant
    `bidding_algorithms.code` en base."""

    code: str = ""  # à override dans la sous-classe

    def __init__(self, config: dict[str, Any]) -> None:
        self.config: dict[str, Any] = config or {}

    @abstractmethod
    def predict(self, context: dict[str, Any]) -> float:
        """Retourne le `bid_multiplier` optimal pour le contexte donné.
        Le caller clamp à `[MULTIPLIER_MIN, MULTIPLIER_MAX]`."""
        ...

    @abstractmethod
    def learn_one(self, context: dict[str, Any], reward: float) -> None:
        """Apprend d'une observation (online learning)."""
        ...

    @abstractmethod
    def get_state(self) -> dict[str, Any]:
        """Retourne l'état appris, sérialisable JSON pour persistance."""
        ...


def clamp_multiplier(m: float) -> float:
    """Clamp le multiplier sur les bornes globales."""
    if m != m:  # NaN
        return 1.0
    return max(MULTIPLIER_MIN, min(MULTIPLIER_MAX, float(m)))
