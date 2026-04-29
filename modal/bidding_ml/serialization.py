"""Sérialisation des modèles river en JSONB.

⚠️ SÉCURITÉ : `pickle.loads` exécute du code arbitraire. Cette utilisation
n'est sûre que parce que les données viennent de NOTRE base, écrites par
NOTRE service Modal authentifié via service_role_key. Ne JAMAIS désérialiser
un payload provenant d'une source externe.
"""
from __future__ import annotations

import base64
import pickle
from typing import Any


def serialize_model(model: Any) -> dict[str, Any]:
    """Sérialise un modèle river en dict JSON-safe."""
    pkl_bytes = pickle.dumps(model)
    return {
        "_serializer": "pickle_b64",
        "_version": 1,
        "data": base64.b64encode(pkl_bytes).decode("ascii"),
        "size_bytes": len(pkl_bytes),
    }


def deserialize_model(payload: dict[str, Any]) -> Any:
    """Reconstitue un modèle depuis le format sérialisé."""
    serializer = payload.get("_serializer")
    if serializer != "pickle_b64":
        raise ValueError(f"Unknown serializer: {serializer!r}")
    pkl_bytes = base64.b64decode(payload["data"])
    return pickle.loads(pkl_bytes)  # noqa: S301
