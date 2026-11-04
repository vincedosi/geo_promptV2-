"""Repli des lignes d'un même code postal, poids de classe, taux d'utile — port de `lib/zones/plan.ts`.

Depuis sql/225, `zone_set_cp` porte une ligne par GRAPPE : un code postal à cheval sur plusieurs bassins en a
plusieurs. Le DSP ne porte qu'un multiplicateur par code postal : on replie AVANT tout calcul. Trois règles :
`pop_en_zone` se somme, `pop_totale` se lit une fois (max, la valeur est répétée), le poids devient la moyenne des
poids de classe pondérée par la population de chaque grappe.
"""

from dataclasses import dataclass

from optimisation.noyau.nombres import math_round, somme_gauche
from optimisation.noyau.types import CpZone, Jeu

# La classe hors zone des jeux risque (`lib/risques/affectation.ts`, `HORS_ZONE`). Jamais un code postal.
CLASSE_HORS = "hors"


def poids_de_classe(jeu: Jeu, classe: str) -> float:
    """`poidsDeClasse` (`lib/zones/jeu.ts`) : hors zone → 0 en exclusif ; sinon le poids réglé, 1 par défaut."""
    if classe == CLASSE_HORS:
        return 0.0 if jeu.mode_plan == "exclusif" else jeu.poids.get(classe, 1.0)
    return jeu.poids.get(classe, 1.0)


@dataclass(frozen=True)
class CpPlie:
    """Un code postal replié, avec les lignes (une par grappe) dont il vient."""

    code_postal: str
    pop_en_zone: float
    pop_totale: float
    retenu: bool
    classe: str
    lignes: tuple[CpZone, ...]


@dataclass(frozen=True)
class CpAgrege:
    """Un code postal replié et son poids (moyenne des poids de classe pondérée par la population des grappes)."""

    code_postal: str
    pop_en_zone: float
    pop_totale: float
    retenu: bool
    classe: str
    poids: float


def plier_par_code_postal(cps: list[CpZone]) -> list[CpPlie]:
    """`plierParCodePostal` : une ligne par code postal, dans l'ordre de première apparition (ordre d'une `Map` JS)."""
    par: dict[str, list[CpZone]] = {}
    for cp in cps:
        par.setdefault(cp.code_postal, []).append(cp)

    sortie: list[CpPlie] = []
    for code_postal, lignes in par.items():
        pop_en_zone = somme_gauche(ligne.pop_en_zone for ligne in lignes)
        # `max` et non une somme : la valeur est la même sur toutes les lignes. Liste jamais vide ici.
        pop_totale = max(ligne.pop_totale for ligne in lignes)
        retenu = any(ligne.retenu for ligne in lignes)
        # La dominante : la PREMIÈRE ligne qui porte le plus de monde (`reduce((a, b) => b > a ? b : a)`).
        dominante = lignes[0]
        for ligne in lignes[1:]:
            if ligne.pop_en_zone > dominante.pop_en_zone:
                dominante = ligne
        sortie.append(
            CpPlie(
                code_postal=code_postal,
                pop_en_zone=pop_en_zone,
                pop_totale=pop_totale,
                retenu=retenu,
                classe=dominante.classe,
                lignes=tuple(lignes),
            )
        )
    return sortie


def regrouper_par_code_postal(cps: list[CpZone], jeu: Jeu) -> list[CpAgrege]:
    """`regrouperParCodePostal` : le repli, et le poids moyen pondéré par la population de chaque grappe."""
    sortie: list[CpAgrege] = []
    for cp in plier_par_code_postal(cps):
        if cp.pop_en_zone > 0:
            poids = (
                somme_gauche(ligne.pop_en_zone * poids_de_classe(jeu, ligne.classe) for ligne in cp.lignes)
                / cp.pop_en_zone
            )
        else:
            poids = poids_de_classe(jeu, cp.classe)
        sortie.append(
            CpAgrege(
                code_postal=cp.code_postal,
                pop_en_zone=cp.pop_en_zone,
                pop_totale=cp.pop_totale,
                retenu=cp.retenu,
                classe=cp.classe,
                poids=poids,
            )
        )
    return sortie


def taux_utile(cps: list[CpAgrege]) -> float | None:
    """Population exposée ÷ population des codes postaux retenus, en % au dixième. `None` si rien n'est retenu."""
    retenus = [c for c in cps if c.retenu]
    if not retenus:
        return None
    totale = somme_gauche(c.pop_totale for c in retenus)
    if totale <= 0:
        return None
    exposee = somme_gauche(c.pop_en_zone for c in retenus)
    # `Math.round((exposee / totale) * 1000) / 10` : au dixième de pour cent.
    return math_round((exposee / totale) * 1000) / 10
