"""PARITÉ du plan initial (T3, plan § 5.1) : le noyau Python rend, pour chaque appel enregistré par le TS, la même
sortie — multiplicateurs et résumé à l'égalité EXACTE, part prévue à 1e-12 relatif — et la même empreinte md5.

276 cas : 104 appels des tests unitaires TS, 168 appels des 6 zones de référence, 4 extractions risque.
"""

import json
from functools import cache
from typing import Any

import pytest

from optimisation.empreinte import empreinte_jeu_risque, empreinte_jeu_zone
from tests.parite.adaptation import FIXTURES, charger, decoder, rejouer


@cache
def unitaires() -> list[dict[str, Any]]:
    return list(charger("tests-unitaires.json.gz")["cas"])


@cache
def zones() -> list[dict[str, Any]]:
    return list(charger("zones-reference.json.gz")["cas"])


@cache
def risque() -> list[dict[str, Any]]:
    return list(charger("extractions-risque.json.gz")["cas"])


N_ZONES = int(json.loads((FIXTURES / "bilan.json").read_text(encoding="utf-8"))["appels_zones"])


@pytest.mark.parametrize("rang", range(104))
def test_parite_tests_unitaires(rang: int) -> None:
    cas = unitaires()[rang]
    assert rejouer(cas) == [], cas["id"]


@pytest.mark.parametrize("rang", range(N_ZONES))
def test_parite_zones_de_reference(rang: int) -> None:
    cas = zones()[rang]
    assert rejouer(cas) == [], cas["id"]


@pytest.mark.parametrize("rang", range(4))
def test_parite_extractions_risque(rang: int) -> None:
    cas = risque()[rang]
    assert rejouer(cas) == [], cas["id"]


def test_les_comptes_sont_ceux_du_readme() -> None:
    assert len(unitaires()) == 104
    assert N_ZONES == len(zones()) == 168
    assert len(risque()) == 4


# ── Empreintes md5 (formules sql/231 et sql/317) ─────────────────────────────────────────────────────────────────────


def _paires(lignes: Any) -> list[tuple[str, float]]:
    return [(ligne["code_postal"], ligne["multiplicateur"]) for ligne in lignes]


def test_empreinte_risque_python_egale_a_l_empreinte_stockee_des_plans_initiaux() -> None:
    """Les versions 1 (plan initial) : l'empreinte du plan PYTHON est celle que la base a écrite."""
    from optimisation.noyau.plan_risque import generer_plan_cp
    from tests.parite.adaptation import cp_zone, groupes, jeu

    initiales = [c for c in risque() if c["stocke"]["extraction"]["version"] == 1]
    assert len(initiales) == 2
    for cas in initiales:
        args = decoder(cas["entree"]["args"])
        plan = generer_plan_cp([cp_zone(x) for x in args[0]], jeu(args[1]), groupes(args[2]))
        extraction = cas["stocke"]["extraction"]
        seuil = format(extraction["seuil_couverture_cp"], "g")
        assert empreinte_jeu_risque(seuil, extraction["mode_plan"], _paires(plan["lignes"])) == extraction["empreinte"]


def test_empreinte_risque_python_egale_a_l_empreinte_ts_sur_les_quatre() -> None:
    for cas in risque():
        from optimisation.noyau.plan_risque import generer_plan_cp
        from tests.parite.adaptation import cp_zone, groupes, jeu

        args = decoder(cas["entree"]["args"])
        plan = generer_plan_cp([cp_zone(x) for x in args[0]], jeu(args[1]), groupes(args[2]))
        ts = decoder(cas["sortie"])
        assert empreinte_jeu_risque("20", "pondere", _paires(plan["lignes"])) == empreinte_jeu_risque(
            "20", "pondere", _paires(ts["lignes"])
        )


def test_empreinte_jeu_zone_python_egale_a_l_empreinte_ts() -> None:
    """Par déclinaison : plan commun (`planCpDeZone`) + plans par plateforme (lignes retenues), formule sql/317."""
    from tests.parite.adaptation import ADAPTATEURS

    par_test: dict[str, dict[str, dict[str, Any]]] = {}
    for cas in zones():
        if cas["fonction"] in ("planCpDeZone", "plansParPlateforme"):
            par_test.setdefault(cas["test"], {})[cas["fonction"]] = cas
    assert len(par_test) == 24
    for test, appels in par_test.items():
        commun, propres = appels["planCpDeZone"], appels["plansParPlateforme"]
        mode = decoder(commun["entree"]["args"])[2]

        def empreinte(commun_sortie: Any, propres_sortie: Any, mode: str = mode) -> str:
            plans = [
                (
                    p["plateforme"],
                    [
                        (ligne["code_postal"], ligne["multiplicateur"])
                        for ligne in p["plan"]["lignes"]
                        if ligne["retenu"]
                    ],
                )
                for p in propres_sortie["plans"]
            ]
            return empreinte_jeu_zone(mode, "choix", _paires(commun_sortie["lignes"]), "", None, plans)

        ts = empreinte(decoder(commun["sortie"]), decoder(propres["sortie"]))
        py = empreinte(
            ADAPTATEURS["planCpDeZone"](decoder(commun["entree"]["args"])),
            ADAPTATEURS["plansParPlateforme"](decoder(propres["entree"]["args"])),
        )
        assert py == ts, test
