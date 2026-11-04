"""`POST /v1/historique/recaler` (tâche 1.6) : la route rend, au bit près, la sortie de `recaler` enregistrée par le TS.

Les cas viennent de `fixtures/historique.json.gz` (lot 2) : tests TS, entrée « 4 départements », limites et 200 cas
aléatoires. Les `Map` voyagent en listes de paires, dans leur ordre d'insertion.
"""

import math
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from optimisation.api.app import app
from tests.parite.historique import contenu, decoder, identique

CLE = "cle-de-test-sans-valeur"
ENTETE = {"X-Optimisation-Cle": CLE}


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("OPTIMISATION_CLE_INTERNE", CLE)
    yield TestClient(app)


def _cas_recaler() -> list[dict[str, Any]]:
    tous = [c for c in contenu()["cas"] if c["fonction"] == "recaler"]
    aleatoires = [c for c in tous if c["source"] == "aléatoires"][:200]
    return [c for c in tous if c["source"] != "aléatoires"] + aleatoires


def _fini(v: Any) -> bool:
    if isinstance(v, float):
        return math.isfinite(v)
    if isinstance(v, dict):
        return all(_fini(x) for x in v.values())
    if isinstance(v, list):
        return all(_fini(x) for x in v)
    return True


def _corps(args: list[Any]) -> dict[str, Any]:
    cps, observees, cible, p = args
    return {
        "cps": [
            {
                "code_postal": c["code_postal"],
                "cluster_id": c.get("cluster_id"),
                "multiplicateur": c["multiplicateur"],
                "part_en_zone": c["part_en_zone"],
            }
            for c in cps
        ],
        "utiles_observees": [[k, v] for k, v in observees.items()],
        "cible": [[k, v] for k, v in cible.items()],
        "params": {k: p[k] for k in ("amortissement", "seuilDilution", "baisseDilues")},
    }


def test_route_recaler_rend_la_sortie_du_ts(client: TestClient) -> None:
    joues = 0
    hors_domaine = 0
    for cas in _cas_recaler():
        args = decoder(cas["entree"]["args"])
        if not _fini(args):
            # NaN / ±∞ : JSON ne les porte pas (Next ne peut pas les envoyer) ; refus testé dans test_entrees.py.
            hors_domaine += 1
            continue
        reponse = client.post("/v1/historique/recaler", json=_corps(args), headers=ENTETE)
        if reponse.status_code == 422:
            # Cas aux limites hors domaine de la route (NaN, négatifs, part > 100, amortissement > 1…) : refusés en
            # 422 français, jamais calculés. Comptés pour qu'ils ne masquent pas la parité.
            assert reponse.status_code == 422, (cas["id"], reponse.text)
            hors_domaine += 1
            continue
        assert reponse.status_code == 200, (cas["id"], reponse.text)
        rendu = reponse.json()
        assert rendu["algo"]["moteur"] == "python"
        ts = decoder(cas["sortie"])
        py = {
            "multiplicateurs": {k: float(v) for k, v in rendu["multiplicateurs"]},
            "corrections": {k: float(v) for k, v in rendu["corrections"]},
            "dilues": rendu["dilues"],
        }
        # JSON n'a pas de −0 : `json_js` écrit 0. Comparé après la même normalisation côté TS.
        ts_json = {
            "multiplicateurs": {k: v + 0.0 for k, v in ts["multiplicateurs"].items()},
            "corrections": {k: v + 0.0 for k, v in ts["corrections"].items()},
            "dilues": ts["dilues"],
        }
        assert identique(py, ts_json), cas["id"]
        joues += 1
    assert joues >= 200, (joues, hors_domaine)
    assert hors_domaine <= 8, hors_domaine  # au plus les 8 cas « limites »


def test_ordre_des_paires_conserve_meme_pour_des_codes_numeriques(client: TestClient) -> None:
    corps = {
        "cps": [
            {"code_postal": "75011", "cluster_id": "b", "multiplicateur": 1, "part_en_zone": 50},
            {"code_postal": "13001", "cluster_id": "a", "multiplicateur": 2, "part_en_zone": 10},
        ],
        "utiles_observees": [["b", 30], ["a", 70]],
        "cible": [["b", 0.5], ["a", 0.5]],
        "params": {"amortissement": 0.8, "seuilDilution": 20, "baisseDilues": 0.6},
    }
    rendu = client.post("/v1/historique/recaler", json=corps, headers=ENTETE).json()
    assert [k for k, _ in rendu["multiplicateurs"]] == ["75011", "13001"]
    assert [k for k, _ in rendu["corrections"]] == ["b", "a"]
    assert rendu["dilues"] == ["13001"]


def test_entree_hors_domaine_refusee_en_francais(client: TestClient) -> None:
    corps = {
        "cps": [{"code_postal": "75011", "cluster_id": None, "multiplicateur": -1, "part_en_zone": 50}],
        "utiles_observees": [],
        "cible": [],
        "params": {"amortissement": 0.8, "seuilDilution": 20, "baisseDilues": 0.6},
    }
    reponse = client.post("/v1/historique/recaler", json=corps, headers=ENTETE)
    assert reponse.status_code == 422
    assert reponse.json()["detail"]["message"].startswith("Requête refusée — cps.0.multiplicateur")


def test_sans_cle_401(client: TestClient) -> None:
    assert client.post("/v1/historique/recaler", json={}).status_code == 401
