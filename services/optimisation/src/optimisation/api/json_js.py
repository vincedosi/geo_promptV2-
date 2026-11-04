"""Réponse JSON au format de JavaScript : un nombre entier s'écrit sans décimale (`1`, jamais `1.0`).

Plan § 2.3, point 4 : le texte `jsonb` écrit par la base doit être celui qu'aurait produit le TS. Le noyau calcule en
`float` (le seul nombre de JS) ; `JSON.stringify(1)` écrit `1`, `json.dumps(1.0)` écrit `1.0`. On convertit donc tout
flottant entier exact (|x| < 2⁵³) en `int` avant d'écrire ; `-0.0` devient `0`, comme `JSON.stringify(-0)`. NaN et
±∞ n'ont pas de JSON : refusés (`allow_nan=False`), comme une valeur que le TS aurait écrite `null` sans le dire.
"""

import json
from collections.abc import Mapping
from typing import Any

from fastapi.responses import JSONResponse

_ENTIER_EXACT = 2.0**53


def normaliser(valeur: Any) -> Any:
    """Copie de `valeur` où chaque flottant entier exact devient un `int`."""
    if isinstance(valeur, bool) or valeur is None or isinstance(valeur, str | int):
        return valeur
    if isinstance(valeur, float):
        return int(valeur) if valeur.is_integer() and abs(valeur) < _ENTIER_EXACT else valeur
    if isinstance(valeur, Mapping):
        return {str(k): normaliser(v) for k, v in valeur.items()}
    if isinstance(valeur, list | tuple):
        return [normaliser(v) for v in valeur]
    raise TypeError(f"valeur non sérialisable : {type(valeur).__name__}")


def vers_texte(valeur: Any) -> str:
    return json.dumps(normaliser(valeur), ensure_ascii=False, allow_nan=False, separators=(",", ":"))


class ReponseJson(JSONResponse):
    def render(self, content: Any) -> bytes:
        return vers_texte(content).encode("utf-8")
