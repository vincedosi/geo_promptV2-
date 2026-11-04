"""`GET /sante` : protégée par `X-Optimisation-Cle`, dit l'état de la base."""

from collections.abc import Callable, Iterator

import pytest
from fastapi.testclient import TestClient

from optimisation.api.app import app, obtenir_sonde
from optimisation.base import EtatBase, sonder_base

CLE = "cle-de-test-sans-valeur"


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("OPTIMISATION_CLE_INTERNE", CLE)
    yield TestClient(app)
    app.dependency_overrides.clear()


def sonde(etat: EtatBase) -> Callable[[], Callable[[], EtatBase]]:
    return lambda: lambda: etat


def test_sans_cle_401(client: TestClient) -> None:
    app.dependency_overrides[obtenir_sonde] = sonde(EtatBase(ok=True, role="optimisation_service"))
    assert client.get("/sante").status_code == 401


def test_cle_fausse_401(client: TestClient) -> None:
    app.dependency_overrides[obtenir_sonde] = sonde(EtatBase(ok=True, role="optimisation_service"))
    assert client.get("/sante", headers={"X-Optimisation-Cle": CLE + "x"}).status_code == 401


def test_service_sans_cle_configuree_503(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPTIMISATION_CLE_INTERNE", raising=False)
    reponse = TestClient(app).get("/sante", headers={"X-Optimisation-Cle": ""})
    assert reponse.status_code == 503
    assert "OPTIMISATION_CLE_INTERNE" in reponse.json()["detail"]


def test_bonne_cle_et_base_ok_200(client: TestClient) -> None:
    app.dependency_overrides[obtenir_sonde] = sonde(EtatBase(ok=True, role="optimisation_service"))
    reponse = client.get("/sante", headers={"X-Optimisation-Cle": CLE})
    assert reponse.status_code == 200
    assert reponse.json()["base"] == {"ok": True, "role": "optimisation_service", "erreur": None}


def test_base_en_panne_503_et_le_dit(client: TestClient) -> None:
    app.dependency_overrides[obtenir_sonde] = sonde(EtatBase(ok=False, erreur="OperationalError: refusée"))
    reponse = client.get("/sante", headers={"X-Optimisation-Cle": CLE})
    assert reponse.status_code == 503
    assert reponse.json()["base"]["ok"] is False


def test_sonde_sans_url_ne_leve_pas() -> None:
    assert sonder_base(None) == EtatBase(ok=False, erreur="OPTIMISATION_DATABASE_URL absente")


def test_sonde_base_injoignable_ne_leve_pas_et_ne_fuit_pas_le_mot_de_passe() -> None:
    etat = sonder_base("postgresql://u:motdepasse-factice@127.0.0.1:1/postgres")
    assert etat.ok is False
    assert etat.erreur is not None
    assert "motdepasse-factice" not in etat.erreur


@pytest.mark.parametrize("chemin", ["/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"])
def test_documentation_non_servie_meme_avec_la_cle(client: TestClient, chemin: str) -> None:
    assert client.get(chemin).status_code in (401, 404)
    assert client.get(chemin, headers={"X-Optimisation-Cle": CLE}).status_code == 404


def test_schema_openapi_reste_produit_en_interne() -> None:
    assert "/sante" in app.openapi()["paths"]


def test_cle_recue_normalisee_comme_la_cle_attendue(client: TestClient) -> None:
    app.dependency_overrides[obtenir_sonde] = sonde(EtatBase(ok=True, role="optimisation_service"))
    assert client.get("/sante", headers={"X-Optimisation-Cle": f" {CLE} "}).status_code == 200
    assert client.get("/sante", headers={"X-Optimisation-Cle": "   "}).status_code == 401
