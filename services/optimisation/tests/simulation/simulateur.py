"""`lib/demo/simulator.ts` porté bit à bit (`simulateDelivery`).

Délivrance par CP = audience × saturation(enchère × gain × résistance) × bruit, la résistance FIXE par (graine, CP),
le bruit variable par période ; normalisée au volume de la période, arrondie à la manière de `Math.round`.

Pièges reproduits :
- la clé du bruit interpole `period` comme le fait un gabarit JS (`texte_nombre_js`) : `1` et `1.0` donnent `"1"` ;
- `Math.max(0, v)` rend NaN pour un NaN (Python `max` rendrait 0) ;
- `sum || 1` : une somme nulle OU NaN devient 1 ;
- un CP présent dans deux items prend l'enchère du DERNIER sans changer de rang (un `Map`).
"""

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal

from optimisation.noyau.math_js import max_js
from optimisation.noyau.nombres import arrondi_js, math_round, somme_gauche
from tests.simulation.rng import rng_for


@dataclass(frozen=True)
class SimItem:
    zone_id: str
    item_id: str
    bid_share: float
    cps: Sequence[str]


@dataclass(frozen=True)
class SimInput:
    items: Sequence[SimItem]
    audience_by_cp: Mapping[str, float | None]
    seed: float
    period: float
    total_volume: float
    gain: float | None = None
    noise: float | None = None


@dataclass(frozen=True)
class SimDeliveryRow:
    postal_code: str
    impressions: float
    clicks: float
    spend: float


def texte_nombre_js(x: float) -> str:
    """`String(x)` d'un nombre JS (ECMA-262 Number::toString, base 10)."""
    if isinstance(x, bool):
        raise TypeError("booléen")
    if isinstance(x, int):
        return str(x)
    if math.isnan(x):
        return "NaN"
    if math.isinf(x):
        return "Infinity" if x > 0 else "-Infinity"
    if x == 0:
        return "0"
    signe = "-" if x < 0 else ""
    # repr rend les chiffres les plus courts qui relisent x — les mêmes que JS ; seul le format diffère.
    t = Decimal(repr(abs(x))).normalize().as_tuple()
    chiffres = "".join(str(c) for c in t.digits)
    k = len(chiffres)
    n = k + int(t.exponent)  # x = 0.chiffres × 10^n
    if k <= n <= 21:
        return signe + chiffres + "0" * (n - k)
    if 0 < n <= 21:
        return signe + chiffres[:n] + "." + chiffres[n:]
    if -6 < n <= 0:
        return signe + "0." + "0" * (-n) + chiffres
    e = n - 1
    corps = chiffres if k == 1 else chiffres[0] + "." + chiffres[1:]
    return f"{signe}{corps}e{'+' if e >= 0 else '-'}{abs(e)}"


def _saturer(x: float) -> float:
    """`x / (1 + x)` ; en x = −1, le −∞ du JS (Python lèverait ZeroDivisionError)."""
    if 1 + x == 0:
        return -math.inf
    return x / (1 + x)


def simulate_delivery(entree: SimInput) -> list[SimDeliveryRow]:
    """`simulateDelivery(input)`."""
    gain = 3 if entree.gain is None else entree.gain
    bruit = 0.1 if entree.noise is None else entree.noise

    poids_par_cp: dict[str, float] = {}
    for it in entree.items:
        for cp in it.cps:
            poids_par_cp[cp] = it.bid_share

    brut: list[tuple[str, float]] = []
    periode = texte_nombre_js(entree.period)
    for cp, poids in poids_par_cp.items():
        audience = entree.audience_by_cp.get(cp)
        audience = 0 if audience is None else audience
        resistance = 0.3 + 0.7 * rng_for(entree.seed, f"res:{cp}")
        terme_bruit = 1 + (rng_for(entree.seed, f"noise:{periode}:{cp}") - 0.5) * 2 * bruit
        v = audience * _saturer(poids * gain * resistance) * terme_bruit
        brut.append((cp, max_js(0, v)))

    somme = somme_gauche(v for _, v in brut)
    if somme == 0 or math.isnan(somme):
        somme = 1
    lignes: list[SimDeliveryRow] = []
    for cp, v in brut:
        impressions = math_round((v / somme) * entree.total_volume)
        ctr = 0.005 + 0.02 * rng_for(entree.seed, f"ctr:{cp}")
        cpm = 3 + 4 * rng_for(entree.seed, f"cpm:{cp}")
        lignes.append(
            SimDeliveryRow(
                postal_code=cp,
                impressions=impressions,
                clicks=math_round(impressions * ctr),
                spend=arrondi_js((impressions / 1000) * cpm, 2),
            )
        )
    return lignes
