"""Les IMPRESSIONS PRÉVUES — port à l'identique de `angular/src/app/features/carte/logique/plan/impressions.ts`
(phase 1.2). Flottants JS : `Math.round` → `math_round`, `reduce` → somme de gauche à droite.

- par plateforme : budget ÷ CPM × 1 000, arrondi à l'unité ;
- totaux : Σ budgets, Σ impressions, CPM moyen PONDÉRÉ (2 décimales), plateformes sans CPM positif ;
- par CP : impressions × multiplicateur ÷ Σ multiplicateurs positifs, planchers puis PLUS FORTS RESTES (la somme des
  CP retombe exactement sur le total), tri par impressions décroissantes puis par code.

Le tri par code emploie `localeCompare` en TS ; pour des codes postaux (chiffres, `2A`/`2B` en majuscules) l'ordre ICU
et l'ordre des points de code coïncident — c'est l'ordre des points de code qui est employé ici, et la fixture de la
démo (11 435 codes) le vérifie.
"""

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from optimisation.noyau.nombres import arrondi_js, math_round


@dataclass(frozen=True)
class PrevisionPlateforme:
    code: str
    budget: float | None
    cpm: float | None
    impressions: float | None


@dataclass(frozen=True)
class TotauxPrevus:
    budget: float | None
    impressions: float | None
    cpm_moyen: float | None
    cpm_manquants: list[str]


@dataclass(frozen=True)
class CpExtraction:
    code_postal: str
    multiplicateur: float


@dataclass(frozen=True)
class ImpressionsCp:
    code_postal: str
    multiplicateur: float
    impressions: float


def _vrai_js(v: float | None) -> bool:
    """La « vérité » JS d'un nombre : ni null, ni 0, ni NaN."""
    return v is not None and v != 0 and not math.isnan(v)


def _positif(v: float | None) -> bool:
    """`positif` du TS : nombre fini strictement positif."""
    return v is not None and math.isfinite(v) and v > 0


def impressions_prevues(budget: float | None, cpm: float | None) -> float | None:
    """`impressionsPrevues` : `budget && cpm && cpm > 0 ? Math.round(budget / cpm × 1000) : null`."""
    if budget is not None and cpm is not None and _vrai_js(budget) and _vrai_js(cpm) and cpm > 0:
        return math_round((budget / cpm) * 1000)
    return None


def previsions(
    codes: Sequence[str], budgets: Mapping[str, float], cpms: Mapping[str, float]
) -> list[PrevisionPlateforme]:
    """Une ligne par plateforme cochée, dans l'ordre donné."""
    lignes = []
    for code in codes:
        budget = budgets.get(code)
        cpm = cpms.get(code)
        lignes.append(PrevisionPlateforme(code, budget, cpm, impressions_prevues(budget, cpm)))
    return lignes


def totaux_prevus(lignes: Sequence[PrevisionPlateforme]) -> TotauxPrevus:
    """`totauxPrevus` : sommes de gauche à droite, CPM moyen pondéré sur les seules plateformes chiffrées."""
    budget = 0.0
    for ligne in lignes:
        budget = budget + (ligne.budget if _positif(ligne.budget) and ligne.budget is not None else 0.0)
    chiffrees = [ligne for ligne in lignes if ligne.impressions is not None]
    impressions = 0.0
    budget_chiffre = 0.0
    for ligne in chiffrees:
        impressions = impressions + (ligne.impressions if ligne.impressions is not None else 0.0)
    for ligne in chiffrees:
        budget_chiffre = budget_chiffre + (ligne.budget if ligne.budget is not None else 0.0)
    return TotauxPrevus(
        budget=arrondi_js(budget, 2) if budget > 0 else None,
        impressions=impressions if impressions > 0 else None,
        cpm_moyen=arrondi_js((budget_chiffre / impressions) * 1000, 2) if impressions > 0 else None,
        cpm_manquants=[ligne.code for ligne in lignes if not _positif(ligne.cpm)],
    )


def repartition_par_cp(impressions: float | None, cps: Sequence[CpExtraction]) -> list[ImpressionsCp]:
    """`repartitionParCp` : planchers, plus forts restes (à égalité, l'ordre reçu), tri impressions ↓ puis code ↑."""
    somme = 0.0
    for c in cps:
        somme = somme + (c.multiplicateur if _positif(c.multiplicateur) else 0.0)
    if impressions is None or not _positif(impressions) or somme <= 0:
        return []
    retenus = [c for c in cps if _positif(c.multiplicateur)]
    planchers: list[float] = []
    restes: list[float] = []
    for c in retenus:
        exacte = (impressions * c.multiplicateur) / somme
        planchers.append(float(math.floor(exacte)))
        restes.append(exacte - math.floor(exacte))
    total_planchers = 0.0
    for p in planchers:
        total_planchers = total_planchers + p
    manque = impressions - total_planchers
    for rang in sorted(range(len(retenus)), key=lambda r: (-restes[r], r)):
        if manque <= 0:
            break
        planchers[rang] = planchers[rang] + 1
        manque = manque - 1
    ordre = sorted(range(len(retenus)), key=lambda r: (-planchers[r], retenus[r].code_postal))
    return [ImpressionsCp(retenus[r].code_postal, retenus[r].multiplicateur, planchers[r]) for r in ordre]
