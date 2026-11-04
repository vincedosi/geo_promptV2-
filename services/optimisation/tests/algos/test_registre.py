"""Catalogue d'algorithmes (phase 2.5, plan § 16) : registre cohérent, refus en français, et PARITÉ INCHANGÉE.

La parité de phase 1 est rejouée EN PASSANT PAR LE REGISTRE (`executer(id, …)`), sur les mêmes fixtures que
`tests/parite/` : rebid et recalage (3 029 cas, au bit près), méthode A (11 435 multiplicateurs de la démo), méthode B
(tous les cas `planCpDeZone`). Si une entrée du catalogue cessait de pointer sur le port, ou l'enveloppait en changeant
quoi que ce soit, ce fichier échouerait.
"""

import math
import re
from collections.abc import Callable
from decimal import Decimal
from typing import Any

import pytest

from optimisation.algos.contrat import (
    FAMILLES,
    AlgoAVenir,
    AlgoInconnu,
    ParametreInvalide,
    parametres_effectifs,
)
from optimisation.algos.registre import ALGO_CORRECTION_DEFAUT, REGISTRE, catalogue, executer, obtenir
from optimisation.noyau.historique.rebid_plafonne import compute_rebid_weights
from optimisation.noyau.historique.recalage_amorti import recaler
from optimisation.noyau.numeric_pg import texte
from optimisation.noyau.plan_zone import plan_cp_de_zone
from optimisation.noyau.pression import multiplicateurs_methode_a
from tests.parite import adaptation, historique
from tests.parite.demo_sql import entrees, json_decimal

IDS = [
    "plan_donnee_insee",
    "plan_jeu_de_zones",
    "rebid_plafonne",
    "recalage_amorti",
    "uniformiser_global",
    "uniformiser_par_regie",
]

# --- Registre ------------------------------------------------------------------------------------------------------


def test_les_six_entrees_dans_l_ordre() -> None:
    assert list(REGISTRE) == IDS
    assert [a.id for a in catalogue()] == IDS


@pytest.mark.parametrize("algo_id", IDS)
def test_chaque_entree_est_coherente(algo_id: str) -> None:
    a = REGISTRE[algo_id]
    assert re.fullmatch(r"[a-z][a-z0-9_]*", a.id)
    assert a.version >= 1
    assert a.familles and set(a.familles) <= set(FAMILLES)
    assert a.libelle[0].isupper() and not a.libelle.isupper()  # sentence case
    assert len(a.description) >= 80 and a.description.endswith(".")
    assert (a.etat == "a_venir") is (a.calculer is None)
    noms = [p.nom for p in a.parametres]
    assert len(noms) == len(set(noms))
    for p in a.parametres:
        assert p.minimum <= p.defaut <= p.maximum, p.nom
        assert not p.entier or p.defaut == math.floor(p.defaut), p.nom
    for bas, haut in a.ordres:
        assert a.defauts()[bas] <= a.defauts()[haut]
    if a.proposable:
        assert a.familles == ("correction",)


def test_proposable_et_familles() -> None:
    assert [a.id for a in catalogue(proposable=True)] == ["uniformiser_global", "uniformiser_par_regie"]
    assert [a.id for a in catalogue("plan")] == ["plan_donnee_insee", "plan_jeu_de_zones"]
    assert [a.id for a in catalogue("correction", proposable=False)] == ["rebid_plafonne", "recalage_amorti"]


def test_algo_par_defaut() -> None:
    defaut = obtenir(ALGO_CORRECTION_DEFAUT)
    assert defaut.id == "uniformiser_global"
    assert defaut.proposable and defaut.familles == ("correction",)


def test_parametres_du_cahier_point_5_et_du_plan_8() -> None:
    attendus = {
        "alpha": 0.5,
        "coefficient_min": 0.8,
        "coefficient_max": 1.2,
        "fenetre_jours": 7,
        "fenetre_min_jours": 3,
        "dilution_seuil": 20.0,
        "dilution_baisse": 0.6,
        "poids_min": 0.001,
        "poids_max": 999.999,
        "volume_min": 100,
        "cadence_jours": 5,
        "seuil_envoi_anticipe": 5.0,
        "delai_min_anticipe_jours": 3,
        "plafond_cout_pondere": 1.25,
        "rythme_depense_min": 0.5,
        "cycles_butee": 3,
        "reduction_ecart_min": 10.0,
    }
    assert obtenir("uniformiser_par_regie").defauts() == attendus
    # « au global » ajoute la tolérance de « le global décide » (§ 16.6 point 3), et rien d'autre.
    assert obtenir("uniformiser_global").defauts() == {**attendus, "tolerance_global": 10.0}


# --- Ports de phase 1 : référencés, pas recopiés ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ("algo_id", "port"),
    [
        ("plan_donnee_insee", multiplicateurs_methode_a),
        ("plan_jeu_de_zones", plan_cp_de_zone),
        ("rebid_plafonne", compute_rebid_weights),
        ("recalage_amorti", recaler),
    ],
)
def test_le_calcul_est_le_port_lui_meme(algo_id: str, port: Callable[..., Any]) -> None:
    assert obtenir(algo_id).calculer is port


def _par_registre(algo_id: str) -> Callable[..., Any]:
    return lambda *args, **kwargs: executer(algo_id, *args, **kwargs)


@pytest.mark.parametrize(
    ("fonction", "algo_id", "attribut"),
    [
        ("computeRebidWeights", "rebid_plafonne", "compute_rebid_weights"),
        ("recaler", "recalage_amorti", "recaler"),
    ],
)
def test_parite_historique_par_le_registre(
    monkeypatch: pytest.MonkeyPatch, fonction: str, algo_id: str, attribut: str
) -> None:
    monkeypatch.setattr(historique, attribut, _par_registre(algo_id))
    cas = [c for c in historique.contenu()["cas"] if c["fonction"] == fonction]
    assert len(cas) > 1000
    ecarts = [c["id"] for c in cas if not historique.identique(*historique.rejouer(c))]
    assert ecarts == []


def test_parite_methode_a_par_le_registre() -> None:
    e = entrees()
    s = e["strategie"]
    calcules = executer(
        "plan_donnee_insee",
        univers=e["univers"],
        zone_definie=s["zone_id"] is not None,
        codes_zone=e["codes_zone"],
        valeurs_indicateur={cp: Decimal(v) for cp, v in e["valeurs_indicateur"]},
        poids_en_zone=json_decimal(s["in_zone_weights"]),
        poids_hors_zone=json_decimal(s["out_zone_weights"]),
    )
    ecrits = {cp: m for cp, pays, m, _part, _actif in e["bidding_zone_configs"] if pays == "FR"}
    assert len(calcules) == len(ecrits) == 11_435
    assert [cp for cp, m in calcules.items() if texte(m) != ecrits[cp]] == []
    assert (texte(calcules["13001"]), texte(calcules["75011"]), texte(calcules["29200"])) == ("1.214", "0.848", "1.012")


def test_parite_methode_b_par_le_registre(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(adaptation, "plan_cp_de_zone", _par_registre("plan_jeu_de_zones"))
    cas = [
        c
        for nom in ("tests-unitaires.json.gz", "zones-reference.json.gz")
        for c in adaptation.charger(nom)["cas"]
        if c["fonction"] == "planCpDeZone"
    ]
    assert len(cas) > 0
    assert [c["id"] for c in cas if adaptation.rejouer(c) != []] == []


# --- Refus ---------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("algo_id", ["uniformiser_global", "uniformiser_par_regie"])
def test_un_algo_a_venir_refuse_d_etre_appele(algo_id: str) -> None:
    with pytest.raises(AlgoAVenir) as info:
        executer(algo_id, object())
    assert info.value.refus == "algo_a_venir"
    assert "pas encore calculé (à venir)" in info.value.message


def test_un_algo_inconnu_est_refuse() -> None:
    with pytest.raises(AlgoInconnu) as info:
        executer("lisser_tout")
    assert info.value.message == "Algorithme inconnu : « lisser_tout ». Il n'est pas au catalogue."


# --- Paramètres effectifs ------------------------------------------------------------------------------------------


def test_parametres_effectifs_defauts_et_surcharge() -> None:
    a = obtenir("uniformiser_global")
    assert parametres_effectifs(a, {}) == a.defauts()
    v = parametres_effectifs(a, {"alpha": 0.7, "cadence_jours": 7})
    assert (v["alpha"], v["cadence_jours"], v["coefficient_max"]) == (0.7, 7.0, 1.2)


@pytest.mark.parametrize(
    ("surcharges", "morceau"),
    [
        ({"beta": 1.0}, "Paramètre inconnu"),
        ({"alpha": 1.5}, "hors des bornes"),
        ({"alpha": math.nan}, "non finie"),
        ({"alpha": True}, "non numérique"),
        ({"cadence_jours": 4.5}, "entier"),
        ({"fenetre_jours": 3, "fenetre_min_jours": 5}, "dépasse"),
        ({"delai_min_anticipe_jours": 6, "cadence_jours": 4}, "dépasse"),
    ],
)
def test_parametres_effectifs_refus(surcharges: dict[str, float], morceau: str) -> None:
    with pytest.raises(ParametreInvalide) as info:
        parametres_effectifs(obtenir("uniformiser_global"), surcharges)
    assert morceau in info.value.message
