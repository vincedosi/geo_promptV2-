"""PARITÉ 1.3 — mesures : `calculer_alignement_geo`, `alignement_par_maille`, `get_campaign_suivi` (partie
décisionnelle), contre les SORTIES des fonctions SQL de la base locale, comparées en texte (échelle comprise).

Démo « élections » : score 93, manque 3,84 %, trop 3,35 %, 72,5 % conformes ; département 13 à −48,4 %, 59 à
−46,2 % ; 161 CP cibles sous 70 % du plan ; rythme 0,80.
"""

from datetime import date
from decimal import Decimal
from functools import cache
from typing import Any

import pytest

from optimisation.noyau.mesures import (
    LigneCp,
    LigneJour,
    ParametresCampagne,
    Referentiel,
    StrategieSuivi,
    alignement_geo,
    alignement_par_maille,
    suivi,
)
from optimisation.noyau.numeric_pg import arrondir, texte
from optimisation.noyau.prevu import StrategiePrevue, attendu_a_date
from tests.parite.demo_sql import dec, entrees, json_decimal, sorties


def norm(v: Any) -> Any:
    """Forme comparable : numeric → texte `numeric_out`, entier → texte, le reste tel quel (récursif)."""
    if isinstance(v, bool) or v is None or isinstance(v, str):
        return v
    if isinstance(v, Decimal):
        return texte(v)
    if isinstance(v, int):
        return str(v)
    if isinstance(v, list):
        return [norm(x) for x in v]
    if isinstance(v, dict):
        return {k: norm(x) for k, x in v.items()}
    raise TypeError(type(v))


@cache
def lignes_cp() -> list[LigneCp]:
    return [
        LigneCp(cp, acteur, dept, int(imp), Decimal(sp), int(i7), int(p7), bool(cible), dec(part))
        for cp, acteur, dept, imp, sp, i7, p7, cible, part in entrees()["campaign_cp_rollup"]
    ]


def _jour(t: str | None) -> int | None:
    return None if t is None else date.fromisoformat(t).toordinal()


@cache
def lignes_jour() -> list[LigneJour]:
    return [
        LigneJour(_jour(j) or 0, media, acteur, int(imp), Decimal(sp))
        for j, media, acteur, imp, sp in entrees()["campaign_daily_rollup"]
    ]


def campagne() -> ParametresCampagne:
    c = entrees()["campagne"]
    return ParametresCampagne(Decimal(c["tolerance_pct"]), Decimal(c["overpressure_weight"]))


def referentiel() -> Referentiel:
    e = entrees()
    return Referentiel(
        dept_du_cp=dict(e["ref_codes_postaux"]),
        departements={d: (nom, reg) for d, nom, reg in e["ref_departements"]},
        regions=dict(e["ref_regions"]),
    )


def strategie() -> StrategieSuivi:
    s = entrees()["strategie"]
    prevue = StrategiePrevue(
        dec(s["total_budget"]),
        dec(s["forecast_cpm"]),
        _jour(s["start_date"]),
        _jour(s["end_date"]),
        dec(s["kpi_target"]),
        s["objective_code"],
    )
    mode = json_decimal(s["out_zone_weights"]).get("mode")
    return StrategieSuivi(prevue, mode if isinstance(mode, str) else None)


@pytest.mark.parametrize("rang", range(5))
def test_alignement_geo_identique_au_sql(rang: int) -> None:
    cas = sorties()["calculer_alignement_geo"][rang]
    obtenu = alignement_geo(lignes_cp(), campagne(), dec(cas["tolerance"]), dec(cas["poids"]))
    assert norm(obtenu) == norm(json_decimal(cas["sortie"]))


def test_alignement_geo_chiffres_du_document() -> None:
    r = alignement_geo(lignes_cp(), campagne(), Decimal(10), Decimal("1.0"))
    assert (texte(r["score"]), texte(r["sous_pression_pct"]), texte(r["sur_pression_pct"])) == ("93", "3.84", "3.35")
    assert texte(r["conformes_pct"]) == "72.5"


def test_alignement_geo_cas_degeneres() -> None:
    assert alignement_geo(lignes_cp(), None) == {"error": "campagne_introuvable", "calculable": False}
    assert alignement_geo([], campagne()) == {"error": "aucune_donnee", "calculable": False, "n_cp": 0}
    sans_plan = [LigneCp("75001", "a", "75", 10, Decimal("1.5"), 0, 0, False, None)]
    r = alignement_geo(sans_plan, campagne())
    assert r["error"] == "plan_absent" and r["impressions_totales"] == 10


def _tranches_egales(unites: list[Any]) -> list[Any]:
    """Les unités regroupées par volume déplacé : l'ordre DANS un groupe à égalité n'est pas défini en SQL."""
    groupes: dict[Any, list[Any]] = {}
    for u in unites:
        groupes.setdefault(u["volume_deplace"], []).append(u)
    return [(v, sorted(g, key=lambda u: u["code"])) for v, g in groupes.items()]


@pytest.mark.parametrize("rang", range(7))
def test_alignement_par_maille_identique_au_sql(rang: int) -> None:
    cas = sorties()["alignement_par_maille"][rang]
    obtenu = norm(
        alignement_par_maille(
            lignes_cp(), referentiel(), campagne(), cas["maille"], cas["parent"], dec(cas["tolerance"]), cas["limite"]
        )
    )
    attendu = norm(json_decimal(cas["sortie"]))
    assert {k: v for k, v in obtenu.items() if k != "unites"} == {k: v for k, v in attendu.items() if k != "unites"}
    assert [u["volume_deplace"] for u in obtenu["unites"]] == [u["volume_deplace"] for u in attendu["unites"]]
    # La limite peut couper au milieu d'un groupe à égalité : seul le DERNIER groupe peut alors différer.
    o, a = _tranches_egales(obtenu["unites"]), _tranches_egales(attendu["unites"])
    tronque = len(attendu["unites"]) == cas["limite"]
    if tronque:
        assert o[:-1] == a[:-1]
    else:
        assert o == a


def test_alignement_par_maille_chiffres_du_document() -> None:
    r = alignement_par_maille(lignes_cp(), referentiel(), campagne(), "departement")
    par_code = {u["code"]: u for u in r["unites"]}
    assert texte(par_code["13"]["ecart_pct"]) == "-48.4"
    assert texte(par_code["59"]["ecart_pct"]) == "-46.2"
    assert texte(par_code["62"]["ecart_pct"]) == "11.3"


def test_alignement_par_maille_refuse_une_maille_inconnue() -> None:
    with pytest.raises(ValueError, match="maille inconnue"):
        alignement_par_maille(lignes_cp(), referentiel(), campagne(), "commune")


def _attendu_global() -> Decimal | None:
    au = max(j.jour for j in lignes_jour())
    return attendu_a_date(strategie().prevue, au)


def _multiplicateurs_actifs() -> list[Decimal]:
    return [Decimal(m) for _cp, _p, m, _part, actif in entrees()["bidding_zone_configs"] if actif]


CLES_SUIVI = ("pacing", "cpm", "pressure", "objective", "objective_zones", "alerts")


@pytest.mark.parametrize("rang", range(4))
def test_suivi_identique_au_sql(rang: int) -> None:
    cas = sorties()["get_campaign_suivi"][rang]
    obtenu = suivi(
        strategie(), lignes_jour(), lignes_cp(), _multiplicateurs_actifs(), _attendu_global(), cas["acteurs"]
    )
    attendu = json_decimal(cas["sortie"])
    if "error" in attendu:
        assert norm(obtenu) == norm(attendu)
        return
    assert date.fromordinal(obtenu["jour_au"]).isoformat() == attendu["as_of"]
    assert {k: norm(obtenu[k]) for k in CLES_SUIVI} == {k: norm(attendu[k]) for k in CLES_SUIVI}


def test_suivi_chiffres_du_document() -> None:
    r = suivi(strategie(), lignes_jour(), lignes_cp(), _multiplicateurs_actifs(), _attendu_global())
    assert texte(r["pacing"]["index"]) == "0.80"
    (sous,) = [a for a in r["alerts"] if a["kind"] == "zones_under"]
    assert sous["title"] == "161 CP cibles sous 70 % du plan"
    assert texte(r["objective"]["expected"]) == "4920000"
    assert r["objective"]["realized"] == 3_936_390


def test_suivi_sans_strategie() -> None:
    assert suivi(None, lignes_jour(), lignes_cp(), [], None) == {"error": "no_strategy"}


def test_pas_de_zero_negatif() -> None:
    # Postgres n'a pas de zéro négatif : round(-0.04, 1) rend 0.0 (cas réel : écart d'un CP à −0,04 %).
    assert texte(arrondir(Decimal("-0.04"), 1)) == "0.0"
    assert texte(Decimal("-0.000")) == "0.000"
