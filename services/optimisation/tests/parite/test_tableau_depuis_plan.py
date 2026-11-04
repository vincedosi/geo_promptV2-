"""PARITÉ 2.1 — tableaux par CP depuis le plan : `tableau_depuis_plan` (Python) contre
`refresh_campaign_rollups_depuis_plan(…, true)` (sql/346) sur quatre cas construits.

Fixture partagée avec `tests/integration/rollups-depuis-plan.test.ts`, qui rejoue les mêmes entrées dans la base
(transaction annulée) et vérifie que le SQL rend ces mêmes sorties. Ici : la sortie « sans plan » (rollup d'avant) +
le plan → la sortie « depuis le plan », au texte près. Puis l'EFFET sur les mesures du cas strict.
"""

import json
from decimal import Decimal
from functools import cache
from pathlib import Path
from typing import Any

import pytest

from optimisation.noyau.mesures import LigneCp, LigneJour, ParametresCampagne, StrategieSuivi, alignement_geo, suivi
from optimisation.noyau.numeric_pg import texte
from optimisation.noyau.prevu import LignePlan, StrategiePrevue, par_code, parts_du_plan
from optimisation.noyau.tableaux import tableau_depuis_plan

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "tableau-depuis-plan.json"


@cache
def cas() -> dict[str, dict[str, Any]]:
    contenu: dict[str, Any] = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return {c["nom"]: c for c in contenu["cas"]}


def _lignes(brutes: list[list[Any]]) -> list[LigneCp]:
    return [
        LigneCp(cp, a, d, int(i), Decimal(sp), int(i7), int(p7), bool(cible), None if part is None else Decimal(part))
        for cp, a, d, i, sp, i7, p7, cible, part in brutes
    ]


def _plan(c: dict[str, Any]) -> list[LignePlan]:
    return [LignePlan(cp, Decimal(m), None if p is None else Decimal(p), actif) for cp, m, p, actif in c["plan"]]


def _texte(lignes: list[LigneCp]) -> list[tuple[Any, ...]]:
    return [
        (
            x.code_postal,
            x.acteur,
            x.dept,
            x.impressions,
            texte(x.depense),
            x.imps_7j,
            x.imps_7j_precedents,
            x.en_cible,
            None if x.part_plan is None else texte(x.part_plan),
        )
        for x in lignes
    ]


def _depuis_plan(nom: str) -> list[LigneCp]:
    c = cas()[nom]
    parts = par_code(parts_du_plan(_plan(c), c["out_zone_weights"].get("mode")))
    return tableau_depuis_plan(_lignes(c["sortie_sans_plan"]["lignes"]), parts)


@pytest.mark.parametrize("nom", ["strict", "national", "part_prevue", "sans_livraison"])
def test_identique_au_sql(nom: str) -> None:
    c = cas()[nom]
    attendu = [tuple(x) for x in c["sortie_depuis_plan"]["lignes"]]
    assert _texte(_depuis_plan(nom)) == attendu
    ajoutees = len(c["sortie_depuis_plan"]["lignes"]) - len(c["sortie_sans_plan"]["lignes"])
    assert ajoutees == c["sortie_depuis_plan"]["retour"]["cp_non_servis"] == 2


def test_idempotent_sur_un_rollup_deja_complete() -> None:
    # Un rollup déjà rafraîchi « depuis le plan » ne voit pas ses lignes non servies doublées.
    c = cas()["strict"]
    parts = par_code(parts_du_plan(_plan(c), "exclusion"))
    deja = _lignes(c["sortie_depuis_plan"]["lignes"])
    assert tableau_depuis_plan(deja, parts) == deja


def test_effet_sur_les_mesures_du_cas_strict() -> None:
    avant = _lignes(cas()["strict"]["sortie_sans_plan"]["lignes"])
    apres = _depuis_plan("strict")
    campagne = ParametresCampagne(Decimal(10), Decimal("1.0"))
    g_avant, g_apres = alignement_geo(avant, campagne), alignement_geo(apres, campagne)
    # Les deux codes jamais servis (75003, 13001 : 1/3 du plan) entrent dans le plan compté et dans le manque.
    assert (g_avant["n_cp_plan"], g_apres["n_cp_plan"]) == (2, 4)
    assert (texte(g_avant["score"]), texte(g_apres["score"])) == ("61", "17")

    jours = [LigneJour(1, "", "dv360", 340, Decimal("2.6"))]
    strategie = StrategieSuivi(StrategiePrevue(None, None, None, None, None, None), "exclusion")
    plan = [Decimal(m) for _cp, m, _p, actif in cas()["strict"]["plan"] if actif]
    sous_avant = [
        a["title"] for a in suivi(strategie, jours, avant, plan, None)["alerts"] if a["kind"] == "zones_under"
    ]
    sous_apres = [
        a["title"] for a in suivi(strategie, jours, apres, plan, None)["alerts"] if a["kind"] == "zones_under"
    ]
    assert (sous_avant, sous_apres) == (["1 CP cibles sous 70 % du plan"], ["3 CP cibles sous 70 % du plan"])
