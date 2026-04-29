"""Registre des algos productisés sur Modal.

Pour ajouter un nouvel algo en production :
1. Implémenter une classe `BiddingAlgorithm` dans `modal/bidding_ml/algos/<algo>.py`
2. Ajouter une ligne dans `REGISTRY` ci-dessous
3. Redéployer Modal (`modal deploy app.py`)
4. INSERT row dans `adaptive_model_state` avec `is_active=true` (ou via /train)

Aucun autre fichier ne doit être modifié. L'orchestrateur (`app.py`) reste
agnostique de l'algo concret.
"""
from __future__ import annotations

from typing import Any

from .base import BiddingAlgorithm
from .hoeffding import HoeffdingAlgo


REGISTRY: dict[str, type[BiddingAlgorithm]] = {
    "hoeffding_adaptive_tree": HoeffdingAlgo,
    # Ajouter ici les algos productisés à l'avenir.
}


def load_algo_from_state(model_state: dict[str, Any]) -> BiddingAlgorithm:
    """Instancie l'algo correspondant à une row adaptive_model_state."""
    algo_code = model_state.get("algorithm_code")
    if not algo_code:
        raise ValueError("model_state.algorithm_code manquant")
    klass = REGISTRY.get(algo_code)
    if klass is None:
        raise ValueError(
            f"Algo '{algo_code}' non implémenté côté Modal. "
            f"Ajouter dans modal/bidding_ml/algos/registry.py."
        )
    instance = klass(config=model_state.get("hyperparameters") or {})
    instance.load_state(model_state.get("parameters") or {})
    return instance


def instantiate_fresh(algorithm_code: str, config: dict[str, Any]) -> BiddingAlgorithm:
    """Crée une instance vierge (pour /train)."""
    klass = REGISTRY.get(algorithm_code)
    if klass is None:
        raise ValueError(f"Algo '{algorithm_code}' non implémenté côté Modal.")
    return klass(config=config or {})
