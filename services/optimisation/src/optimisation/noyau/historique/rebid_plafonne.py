"""Rebid correctif plafonné — portage à l'identique de `computeRebidWeights` (`lib/pacing/rebid.ts:30`).

`facteur = clamp(prévu / max(livré, REBID_EPSILON), 1 − REBID_CAP, 1 + REBID_CAP)`, poids brut = poids × facteur,
renormalisé à 100 PAR ZONE (une zone dont la somme brute n'est pas > 0 garde ses poids).

Parité bit à bit : `Math.min`/`Math.max` par `min_js`/`max_js` (NaN, −0), sommes de zone de gauche à droite dans
l'ordre des items (le `Map` du TS), clés de zone dans l'ordre de première apparition.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from optimisation.noyau.math_js import max_js, min_js

REBID_CAP = 0.5
REBID_EPSILON = 0.001


@dataclass(frozen=True)
class RebidItemInput:
    zone_id: str
    item_id: str
    item_weight: float
    expected_share: float
    actual_share: float


@dataclass(frozen=True)
class RebidItem:
    zone_id: str
    item_id: str
    old_weight: float
    new_weight: float


def _clamp(x: float, lo: float, hi: float) -> float:
    return min_js(hi, max_js(lo, x))


def compute_rebid_weights(items: Sequence[RebidItemInput]) -> list[RebidItem]:
    """`computeRebidWeights(items)`, même ordre de sortie que l'entrée."""
    bruts: list[tuple[RebidItemInput, float]] = []
    for it in items:
        facteur = _clamp(it.expected_share / max_js(it.actual_share, REBID_EPSILON), 1 - REBID_CAP, 1 + REBID_CAP)
        bruts.append((it, it.item_weight * facteur))

    somme_zone: dict[str, float] = {}
    for it, brut in bruts:
        somme_zone[it.zone_id] = somme_zone.get(it.zone_id, 0.0) + brut

    sortie: list[RebidItem] = []
    for it, brut in bruts:
        somme = somme_zone.get(it.zone_id, 0.0)
        nouveau = (brut / somme) * 100 if somme > 0 else it.item_weight
        sortie.append(RebidItem(it.zone_id, it.item_id, it.item_weight, nouveau))
    return sortie
