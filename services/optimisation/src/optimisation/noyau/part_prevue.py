"""La PART PRÉVUE d'une unité du plan CP d'un jeu de zone (A8, amendement E5) — port de `lib/zones/part-prevue.ts`.

    poids(u)        = part(u) × volume(u) × classe(u)
    part prévue(u)  = poids(u) ÷ ( Σ_u poids(u) + poids(HORS_ZONE) )

La somme se fait PAR UNITÉ CP (groupe de codes indiscernables), puis la part d'une unité est répartie à parts ÉGALES
entre ses codes. Une part incalculable vaut `None`, jamais 0 (0 se lirait « rien de prévu »). Le multiplicateur n'y
entre pas : un écrêtage change ce qui est envoyé, jamais la part prévue.
"""

import math
from typing import Final

from optimisation.noyau.types import HorsZonePrevue, PartsPrevues, UnitePrevue, Univers

# Q9 = A : le volume attendu d'une unité est sa population totale en V1.
VOLUME_ATTENDU: Final = "population_totale"
# La part d'une unité se partage à parts égales entre ses codes (population d'un membre inconnue, sql/228).
REPARTITION_GROUPE: Final = "egale"
# Le préfixe des codes postaux des DROM (971 à 976). Un fait géographique, pas une règle de plateforme.
PREFIXE_CP_DROM: Final = "97"


def univers_de_zone(codes: list[str], type_recette: str | None, code_recette: str | None) -> Univers:
    """D35 : une zone PAYS dit son univers ; une autre est en France entière dès qu'une unité est dans un DROM."""
    if type_recette == "pays":
        if code_recette not in ("METRO", "FR"):
            raise ValueError(f"recette pays : code inconnu {code_recette!r} (METRO ou FR)")
        return "METRO" if code_recette == "METRO" else "FR"
    return "FR" if any(c.startswith(PREFIXE_CP_DROM) for c in codes) else "METRO"


def poids_prevu(part: float | None, volume: float | None, classe: float) -> float | None:
    """`part × volume × classe`, ou `None` si la part ou le volume manque (volume nul compris)."""
    if part is None or volume is None or not math.isfinite(part) or not math.isfinite(volume) or volume <= 0:
        return None
    return part * volume * classe


def parts_prevues(unites: list[UnitePrevue], hors_zone: HorsZonePrevue | None) -> PartsPrevues:
    """Les parts prévues des unités retenues et de `HORS_ZONE`.

    `HORS_ZONE` de classe 0 (mode strict) pèse 0 quel que soit son volume ; de classe non nulle (mode national), son
    volume est indispensable : sans lui la somme est fausse pour toutes les unités, et tout vaut `None`.
    """
    poids = [poids_prevu(u.part, u.volume, u.classe) for u in unites]
    poids_hz = (
        0.0
        if hors_zone is None or hors_zone.classe == 0
        else poids_prevu(hors_zone.part, hors_zone.volume, hors_zone.classe)
    )
    connus = 0.0
    for p in poids:
        connus = connus + (p if p is not None else 0.0)
    somme = None if poids_hz is None else connus + poids_hz
    valide = somme is not None and somme > 0

    par_unite: dict[str, float | None] = {}
    par_code: dict[str, float | None] = {}
    for u, p in zip(unites, poids, strict=True):
        part = p / somme if valide and somme is not None and p is not None else None
        par_unite[u.code] = part
        n = max(1, len(u.membres))
        for m in u.membres if len(u.membres) > 0 else (u.code,):
            par_code[m] = None if part is None else part / n
    return PartsPrevues(
        par_unite=par_unite,
        par_code=par_code,
        hors_zone=poids_hz / somme if valide and somme is not None and poids_hz is not None else None,
        somme=somme if valide else None,
    )
