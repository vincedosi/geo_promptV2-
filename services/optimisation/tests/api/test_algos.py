"""`GET /v1/algos` (phase 2.6) : le catalogue tel quel, filtré, sans lecture en base ; refus 422 du catalogue."""

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from optimisation.algos.registre import executer
from optimisation.api.app import creer_app
from tests.api.test_plans import CLE, ENTETE


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("OPTIMISATION_CLE_INTERNE", CLE)

    def aucune_base(*_a: Any, **_k: Any) -> Any:
        raise AssertionError("GET /v1/algos ne doit pas lire la base")

    monkeypatch.setattr("psycopg.connect", aucune_base)
    application = creer_app()

    # Route d'essai, sur une instance jetable : aucune route publique n'appelle encore un algorithme par son id (2.7).
    @application.post("/essai/algos/{algo_id}")
    def essai(algo_id: str) -> dict[str, str]:
        executer(algo_id, None)
        return {}

    yield TestClient(application, raise_server_exceptions=False)


def test_sans_cle_401(client: TestClient) -> None:
    assert client.get("/v1/algos").status_code == 401


def test_catalogue_complet(client: TestClient) -> None:
    r = client.get("/v1/algos", headers=ENTETE)
    assert r.status_code == 200
    corps = r.json()
    assert corps["defaut_correction"] == "uniformiser_global"
    ids = [a["id"] for a in corps["algos"]]
    assert ids == [
        "plan_donnee_insee",
        "plan_jeu_de_zones",
        "rebid_plafonne",
        "recalage_amorti",
        "uniformiser_global",
        "uniformiser_par_regie",
    ]
    glob = corps["algos"][4]
    assert glob["etat"] == "a_venir" and glob["proposable"] is True and glob["familles"] == ["correction"]
    alpha = next(p for p in glob["parametres"] if p["nom"] == "alpha")
    assert alpha == {
        "nom": "alpha",
        "libelle": "Force de la correction (α)",
        "defaut": 0.5,
        "minimum": 0.1,
        "maximum": 1.0,
        "unite": "",
        "entier": False,
    }
    assert ["coefficient_min", "coefficient_max"] in glob["ordres"]
    assert "calculer" not in glob


@pytest.mark.parametrize(
    ("requete", "attendus"),
    [
        ("famille=plan", ["plan_donnee_insee", "plan_jeu_de_zones"]),
        ("famille=correction&proposable=true", ["uniformiser_global", "uniformiser_par_regie"]),
        ("proposable=false&famille=correction", ["rebid_plafonne", "recalage_amorti"]),
    ],
)
def test_filtres(client: TestClient, requete: str, attendus: list[str]) -> None:
    r = client.get(f"/v1/algos?{requete}", headers=ENTETE)
    assert r.status_code == 200
    assert [a["id"] for a in r.json()["algos"]] == attendus


def test_filtre_invalide_422_francais(client: TestClient) -> None:
    r = client.get("/v1/algos?famille=enchere", headers=ENTETE)
    assert r.status_code == 422
    assert "famille" in str(r.json()["detail"])
    assert "Input should" not in r.text


@pytest.mark.parametrize("algo_id", ["uniformiser_global", "uniformiser_par_regie"])
def test_algo_a_venir_appele_422(client: TestClient, algo_id: str) -> None:
    r = client.post(f"/essai/algos/{algo_id}", headers=ENTETE)
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail["refus"] == "algo_a_venir"
    assert detail["algo_id"] == algo_id
    assert "à venir" in detail["message"]


def test_algo_inconnu_appele_422(client: TestClient) -> None:
    r = client.post("/essai/algos/inconnu", headers=ENTETE)
    assert r.status_code == 422
    assert r.json()["detail"] == {
        "refus": "algo_inconnu",
        "algo_id": "inconnu",
        "message": "Algorithme inconnu : « inconnu ». Il n'est pas au catalogue.",
    }
