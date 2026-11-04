"""`POST /v1/plans/zone` et `/v1/plans/risque` sans base : lecteur factice, réponses comparées aux fixtures TS."""

import json
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import pytest
from fastapi.testclient import TestClient

from optimisation import base
from optimisation.api.app import app
from optimisation.api.plans import Lecteur, obtenir_source
from optimisation.noyau.types import PlateformePoids, Univers, VolumesAttendus
from tests.parite.adaptation import charger, decoder, ecarts
from tests.plans_fixtures import Declinaison, declinaison

CLE = "cle-de-test-sans-valeur"
ENTETE = {"X-Optimisation-Cle": CLE}


class LecteurFactice:
    def __init__(self, d: Declinaison) -> None:
        self.d = d
        self.appels: list[tuple[str, Any]] = []
        self.ouvertures = 0
        self.rendu = False

    def poids(self, plateformes: list[str]) -> list[PlateformePoids]:
        self.appels.append(("poids", sorted(plateformes)))
        return [p for p in self.d.poids if p.plateforme in plateformes]

    def volumes(self, codes: list[str], univers: Univers) -> VolumesAttendus:
        self.appels.append(("volumes", univers))
        return self.d.volumes


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("OPTIMISATION_CLE_INTERNE", CLE)
    yield TestClient(app)
    app.dependency_overrides.clear()


def brancher(d: Declinaison) -> LecteurFactice:
    lecteur = LecteurFactice(d)

    @contextmanager
    def ouvrir() -> Iterator[Lecteur]:
        lecteur.ouvertures += 1
        yield lecteur
        lecteur.rendu = True

    app.dependency_overrides[obtenir_source] = lambda: ouvrir
    return lecteur


@pytest.mark.parametrize(
    ("zone", "nom"),
    [
        ("strasbourg", "pondere-dv360-ttd"),
        ("paris", "exclusif-dv360-ttd"),
        ("composite", "exclusif-dv360-liste-exacte"),
    ],
)
def test_plan_zone_rend_ce_que_rend_le_ts(client: TestClient, zone: str, nom: str) -> None:
    d = declinaison(zone, nom)
    lecteur = brancher(d)
    reponse = client.post("/v1/plans/zone", headers=ENTETE, json=d.requete)
    assert reponse.status_code == 200, reponse.text
    corps = reponse.json()

    commun = dict(corps["commun"])
    commun["resume"] = {k: v for k, v in commun["resume"].items() if k != "algo"}
    assert ecarts(d.commun, commun) == []
    assert (
        ecarts(
            d.plans["plans"],
            [{k: p[k] for k in ("plateforme", "seuil", "reglage", "plan")} for p in corps["par_plateforme"]],
        )
        == []
    )
    # Générateur : pour chaque plateforme, sortiesPoids sur le commun puis sur son plan.
    attendues = d.sorties
    for i, (c, p) in enumerate(zip(corps["sorties_poids"], corps["par_plateforme"], strict=True)):
        assert ecarts(attendues[2 * i], {"sorties": c["poids"], "avertissements": c["avertissements"]}) == []
        assert ecarts(attendues[2 * i + 1], {"sorties": p["poids"], "avertissements": p["avertissements"]}) == []
    # Univers D35 demandé au lecteur = celui du TS ; une lecture de chaque, dans l'ordre de l'extraction.
    assert lecteur.appels == [("poids", sorted(c["plateforme"] for c in d.requete["choix"])), ("volumes", d.univers)]


def test_plan_zone_ecrit_les_entiers_sans_decimale_et_porte_algo(client: TestClient) -> None:
    d = declinaison("strasbourg", "pondere-dv360-ttd")
    brancher(d)
    texte = client.post("/v1/plans/zone", headers=ENTETE, json=d.requete).text
    assert '"part":1,' in texte and '"part":1.0' not in texte
    assert ".0," not in texte and ".0}" not in texte
    corps = json.loads(texte)
    algo = corps["algo"]
    assert algo["moteur"] == "python" and len(algo["entrees_sha256"]) == 64
    assert corps["commun"]["resume"]["algo"] == algo
    # Même entrée → même empreinte ; une entrée changée → une autre.
    assert client.post("/v1/plans/zone", headers=ENTETE, json=d.requete).json()["algo"] == algo
    autre = {**d.requete, "mode_plan": "exclusif"}
    assert client.post("/v1/plans/zone", headers=ENTETE, json=autre).json()["algo"] != algo


def test_plan_zone_refus_nomme_si_une_plateforme_n_a_pas_de_mecanisme(client: TestClient) -> None:
    d = declinaison("strasbourg", "pondere-dv360-ttd")
    brancher(Declinaison(**{**d.__dict__, "poids": [p for p in d.poids if p.plateforme != "ttd"]}))
    reponse = client.post("/v1/plans/zone", headers=ENTETE, json=d.requete)
    assert reponse.status_code == 422
    assert reponse.json()["detail"]["refus"] == "registre"
    assert "ttd — aucun mécanisme de poids au CP" in reponse.json()["detail"]["message"]


def test_plan_zone_plateforme_en_double_422(client: TestClient) -> None:
    d = declinaison("strasbourg", "pondere-dv360-ttd")
    brancher(d)
    requete = {**d.requete, "choix": [d.requete["choix"][0], d.requete["choix"][0]]}
    assert client.post("/v1/plans/zone", headers=ENTETE, json=requete).status_code == 422


def test_plan_zone_corps_invalide_422(client: TestClient) -> None:
    d = declinaison("strasbourg", "pondere-dv360-ttd")
    brancher(d)
    assert client.post("/v1/plans/zone", headers=ENTETE, json={**d.requete, "mode_plan": "autre"}).status_code == 422
    assert client.post("/v1/plans/zone", headers=ENTETE, json={**d.requete, "inconnu": 1}).status_code == 422


def test_plan_zone_base_indisponible_503_en_francais(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    d = declinaison("strasbourg", "pondere-dv360-ttd")
    monkeypatch.setenv("OPTIMISATION_DATABASE_URL", "postgresql://u:motdepasse-factice@127.0.0.1:1/postgres")
    monkeypatch.setattr(base, "DELAI_EMPRUNT_S", 0.5)
    base.fermer_pool()
    try:
        reponse = client.post("/v1/plans/zone", headers=ENTETE, json=d.requete)
    finally:
        base.fermer_pool()
    assert reponse.status_code == 503
    assert reponse.json()["detail"]["message"] == "Le calcul du plan est indisponible, réessayez dans une minute."
    assert "motdepasse-factice" not in reponse.text


@pytest.mark.parametrize("route", ["/v1/plans/zone", "/v1/plans/risque"])
def test_routes_de_plan_sous_cle(client: TestClient, route: str) -> None:
    assert client.post(route, json={}).status_code == 401
    assert client.post(route, headers={"X-Optimisation-Cle": "fausse"}, json={}).status_code == 401


def test_plan_risque_rend_le_plan_initial_stocke(client: TestClient) -> None:
    cas = next(c for c in charger("extractions-risque.json.gz")["cas"] if c["stocke"]["extraction"]["version"] == 1)
    args = decoder(cas["entree"]["args"])
    requete = {
        "cps": args[0],
        "jeu": {"mode_plan": args[1]["mode_plan"], "poids": args[1]["poids"]},
        "groupes": dict(args[2]),
    }
    reponse = client.post("/v1/plans/risque", headers=ENTETE, json=requete)
    assert reponse.status_code == 200, reponse.text
    corps = reponse.json()
    assert corps["algo"]["moteur"] == "python"
    assert ecarts(decoder(cas["sortie"]), {k: v for k, v in corps.items() if k != "algo"}) == []
    stocke = {ligne["code_postal"]: ligne["multiplicateur"] for ligne in cas["stocke"]["lignes"]}
    assert {ligne["code_postal"]: ligne["multiplicateur"] for ligne in corps["lignes"]} == stocke


def test_openapi_interne_decrit_les_deux_routes() -> None:
    chemins = app.openapi()["paths"]
    assert "/v1/plans/zone" in chemins and "/v1/plans/risque" in chemins
