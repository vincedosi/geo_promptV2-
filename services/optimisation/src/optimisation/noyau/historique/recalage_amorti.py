"""Recalage amorti v1 → v2 — portage à l'identique de `recaler` (`lib/simulation/recalage.ts`).

Par bassin : `correction = clamp(plan / observé, 1/3, 3) ** amortissement` (3 pour un bassin qui n'a rien reçu) ;
par code postal : multiplicateur × correction de son bassin, × `baisse_dilues` sous `seuil_dilution` ; puis recentré
sur 1 (moyenne), arrondi au millième à la manière de `Math.round`, borné à [0,001 ; 999,999].

Parité bit à bit : `Math.pow` par `puissance_js` (fdlibm de V8, ≠ `**` sur 7 % des cas), sommes par
`somme_gauche`, arrondi par `arrondi_js`, `Math.min`/`Math.max` par `min_js`/`max_js`. Ordres : corrections dans
l'ordre de `cible`, multiplicateurs dans l'ordre de première apparition du code postal (un doublon écrase la valeur
sans déplacer la clé, comme un `Map`), dilués dans l'ordre des lignes, doublons compris.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from optimisation.noyau.math_js import max_js, min_js, puissance_js
from optimisation.noyau.nombres import arrondi_js, somme_gauche

CORRECTION_MIN = 1 / 3
CORRECTION_MAX = 3.0
MULT_MIN_NON_NUL = 0.001
MULT_MAX = 999.999


@dataclass(frozen=True)
class CpRecalage:
    """Les champs de `CpSimulation` que `recaler` lit."""

    code_postal: str
    cluster_id: str | None
    multiplicateur: float
    part_en_zone: float


@dataclass(frozen=True)
class ParamsRecalage:
    """Les champs de `ParamsSimulation` que `recaler` lit (défauts de `PARAMS_DEFAUT` : 0,8 / 20 / 0,6)."""

    amortissement: float
    seuil_dilution: float
    baisse_dilues: float


@dataclass
class Recalage:
    multiplicateurs: dict[str, float] = field(default_factory=dict)
    corrections: dict[str, float] = field(default_factory=dict)
    dilues: list[str] = field(default_factory=list)


def recaler(
    cps: Sequence[CpRecalage],
    utiles_observees: Mapping[str, float],
    cible: Mapping[str, float],
    p: ParamsRecalage,
) -> Recalage:
    """`recaler(cps, utilesObservees, cible, P)`."""
    total = somme_gauche(utiles_observees.values())

    corrections: dict[str, float] = {}
    for z, plan in cible.items():
        obs = utiles_observees.get(z, 0.0) / total if total > 0 else 0.0
        brut = plan / obs if obs > 0 else CORRECTION_MAX
        borne = min_js(CORRECTION_MAX, max_js(CORRECTION_MIN, brut))
        corrections[z] = puissance_js(borne, p.amortissement)

    dilues: list[str] = []
    bruts: dict[str, float] = {}
    for c in cps:
        if c.multiplicateur <= 0:
            continue
        m = c.multiplicateur
        if c.cluster_id:
            m *= corrections.get(c.cluster_id, 1.0)
        if c.part_en_zone < p.seuil_dilution:
            m *= p.baisse_dilues
            dilues.append(c.code_postal)
        bruts[c.code_postal] = m

    moyenne = somme_gauche(bruts.values()) / max(1, len(bruts))
    multiplicateurs: dict[str, float] = {}
    for cp, m in bruts.items():
        centre = m / moyenne if moyenne > 0 else 1.0
        multiplicateurs[cp] = min_js(MULT_MAX, max_js(MULT_MIN_NON_NUL, arrondi_js(centre, 3)))
    return Recalage(multiplicateurs, corrections, dilues)
