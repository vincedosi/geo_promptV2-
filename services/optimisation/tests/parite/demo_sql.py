"""Chargement des fixtures SQL de la phase 1 (`generer_fixtures_sql.py`) : la démo « élections » et la grille numeric.

Les `numeric` arrivent en texte et sont relus en `Decimal` (échelle conservée) ; les JSON SQL (`::text` d'un jsonb)
sont relus avec `parse_float=Decimal`, comme le noyau les attend.
"""

import gzip
import json
import math
from decimal import Decimal
from functools import cache
from typing import Any

from tests.parite.adaptation import FIXTURES, decoder


def json_decimal(texte: str) -> Any:
    """Un JSON SQL relu sans flottant : tout nombre devient `Decimal` (entiers compris), échelle conservée."""
    return json.loads(texte, parse_float=Decimal, parse_int=Decimal)


def dec(v: str | None) -> Decimal | None:
    return None if v is None else Decimal(v)


@cache
def demo() -> dict[str, Any]:
    with gzip.open(FIXTURES / "demo-elections.json.gz", "rt", encoding="utf-8") as f:
        contenu: dict[str, Any] = json.load(f)
    return contenu


@cache
def grille_numeric() -> dict[str, Any]:
    with gzip.open(FIXTURES / "sql-numeric.json.gz", "rt", encoding="utf-8") as f:
        contenu: dict[str, Any] = json.load(f)
    return contenu


def entrees() -> dict[str, Any]:
    e: dict[str, Any] = demo()["entrees"]
    return e


def sorties() -> dict[str, Any]:
    s: dict[str, Any] = demo()["sorties"]
    return s


@cache
def _ts_phase1() -> list[dict[str, Any]]:
    with gzip.open(FIXTURES / "ts-phase1.json.gz", "rt", encoding="utf-8") as f:
        contenu: dict[str, Any] = json.load(f)
    return [decoder(c) for c in contenu["cas"]]


def cas_ts(fonction: str) -> list[dict[str, Any]]:
    """Les appels TS enregistrés d'une fonction, décodés (`$nombre`, `$undefined`)."""
    return [c for c in _ts_phase1() if c["fonction"] == fonction]


def meme_nombre(a: float | None, b: Any) -> bool:
    """Égalité JS stricte d'un nombre : NaN = NaN, et le signe d'un zéro compte (`Object.is`)."""
    if a is None or b is None:
        return a is None and b is None
    if not isinstance(b, int | float) or isinstance(b, bool):
        return False
    if math.isnan(a) or math.isnan(b):
        return math.isnan(a) and math.isnan(b)
    return a == b and math.copysign(1.0, a) == math.copysign(1.0, b)
