"""Relecture de phase 1, I2 : `by_tier` / `by_subzone` sont ABANDONNÉS (décision du 05/11). Toute route qui calcule la
méthode A et les rencontre doit répondre 422 « mode abandonné » en français, jamais le 500 générique."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from optimisation.api.app import creer_app
from optimisation.noyau.pression import ModeAbandonne, multiplicateurs_methode_a
from tests.api.test_plans import CLE, ENTETE


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("OPTIMISATION_CLE_INTERNE", CLE)
    application = creer_app()

    # Route d'essai, sur une instance jetable : aucune route publique ne calcule encore la méthode A (phase 2).
    @application.post("/essai/methode-a/{mode}")
    def essai(mode: str) -> dict[str, str]:
        multiplicateurs_methode_a(["75001"], True, ["75001"], {}, {"mode": mode}, {})
        return {}

    yield TestClient(application, raise_server_exceptions=False)


@pytest.mark.parametrize(("mode", "libelle"), [("by_tier", "par palier"), ("by_subzone", "par sous-zone")])
def test_mode_abandonne_rend_422_francais(client: TestClient, mode: str, libelle: str) -> None:
    reponse = client.post(f"/essai/methode-a/{mode}", headers=ENTETE)
    assert reponse.status_code == 422
    detail = reponse.json()["detail"]
    assert detail["refus"] == "mode_abandonne"
    assert detail["mode"] == mode
    assert f"« {libelle} » abandonné" in detail["message"]


def test_exception_porte_le_mode() -> None:
    with pytest.raises(ModeAbandonne) as info:
        multiplicateurs_methode_a(["75001"], True, ["13001"], {}, {}, {"mode": "by_tier"})
    assert info.value.mode == "by_tier"
    assert info.value.libelle == "par palier"
