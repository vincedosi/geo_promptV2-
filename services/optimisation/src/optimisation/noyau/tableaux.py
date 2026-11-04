"""Tableaux par code postal construits DEPUIS LE PLAN (tâche 2.1) — le pendant de la seconde insertion de
`refresh_campaign_rollups_depuis_plan(…, true)` (sql/346).

Le rollup de la livraison (`campaign_cp_rollup`, une ligne par code × acteur SERVI) ne contient pas les codes du plan
jamais servis : ils manquaient au score et à l'alerte « CP cibles sous 70 % du plan ». On les ajoute à 0, une ligne
par code, acteur '' — plan ∪ livraison, les codes livrés hors plan restent (fuite, sur-pression).

« Au plan » = `en_cible` OU part > 0, après `parts_du_plan` + `par_code` (`prevu.py`, CTE `plan` du SQL) : un code à
multiplicateur 0 en mode strict n'y est pas. Sortie triée par (code, acteur) en ordre de points de code — l'ordre
`collate "C"` des lecteurs (UTF-8 trie comme les points de code).
"""

from collections.abc import Mapping, Sequence
from decimal import Decimal

from optimisation.noyau.mesures import LigneCp
from optimisation.noyau.prevu import PartDuPlan

ACTEUR_NON_SERVI = ""


def au_plan(part: PartDuPlan) -> bool:
    return part.en_cible or (part.part is not None and part.part > 0)


def lignes_non_servies(lignes: Sequence[LigneCp], parts: Mapping[str, PartDuPlan]) -> list[LigneCp]:
    """Une ligne à 0 pour chaque code au plan sans aucune ligne livrée (tous acteurs confondus)."""
    servis = {ligne.code_postal for ligne in lignes}
    return [
        LigneCp(code, ACTEUR_NON_SERVI, code[:2], 0, Decimal(0), 0, 0, p.en_cible, p.part)
        for code, p in parts.items()
        if code not in servis and au_plan(p)
    ]


def tableau_depuis_plan(lignes: Sequence[LigneCp], parts: Mapping[str, PartDuPlan]) -> list[LigneCp]:
    """Le rollup livré complété des codes du plan jamais servis, trié par (code, acteur)."""
    return sorted([*lignes, *lignes_non_servies(lignes, parts)], key=lambda x: (x.code_postal, x.acteur))
