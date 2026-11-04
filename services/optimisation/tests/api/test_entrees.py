"""Relecture B : entrées hors domaine refusées en 422 FRANÇAIS avant tout calcul (I1, M1, M3), corps borné (M2),
connexion empruntée après validation et rendue avant le calcul, un calcul à la fois (M4)."""

import copy
import json
import math
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from optimisation import base
from optimisation.api import erreurs, plans
from optimisation.api.app import app
from tests.api.test_plans import CLE, ENTETE, brancher
from tests.parite.adaptation import charger, decoder
from tests.plans_fixtures import declinaison

NAN = math.nan
INF = math.inf


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("OPTIMISATION_CLE_INTERNE", CLE)
    yield TestClient(app)
    app.dependency_overrides.clear()


def _zone() -> dict[str, Any]:
    return copy.deepcopy(declinaison("strasbourg", "pondere-dv360-ttd").requete)


def _risque() -> dict[str, Any]:
    cas = next(c for c in charger("extractions-risque.json.gz")["cas"] if c["stocke"]["extraction"]["version"] == 1)
    args = decoder(cas["entree"]["args"])
    return {"cps": args[0], "jeu": {"mode_plan": args[1]["mode_plan"], "poids": args[1]["poids"]}, "groupes": {}}


def _poser(corps: dict[str, Any], chemin: tuple[Any, ...], valeur: Any) -> dict[str, Any]:
    cible: Any = corps
    for cle in chemin[:-1]:
        cible = cible[cle]
    cible[chemin[-1]] = valeur
    return corps


def _envoyer(client: TestClient, route: str, corps: dict[str, Any]) -> Any:
    # `allow_nan=True` : le texte porte les littéraux `NaN` / `Infinity` que le `json.loads` de Starlette accepte.
    texte = json.dumps(corps, allow_nan=True)
    return client.post(route, headers={**ENTETE, "Content-Type": "application/json"}, content=texte)


def _refus_francais(reponse: Any, champ: str) -> None:
    assert reponse.status_code == 422, reponse.text
    detail = reponse.json()["detail"]
    assert detail["refus"] == "validation"
    assert detail["message"].startswith("Requête refusée")
    assert any(e["champ"] == champ for e in detail["erreurs"]), detail
    for anglais in ("Field required", "Input should", "Internal Server Error", "List should"):
        assert anglais not in reponse.text


@pytest.mark.parametrize(
    ("chemin", "valeur"),
    [
        (("couverture", 0, "pop_en_zone"), NAN),
        (("couverture", 0, "pop_en_zone"), INF),
        (("couverture", 0, "pop_en_zone"), -INF),
        (("couverture", 0, "pop_en_zone"), 1e308),
        (("couverture", 0, "pop_en_zone"), -50.0),
        (("couverture", 0, "pop_totale"), INF),
        (("couverture", 0, "pop_totale"), 1e9),  # au-delà de la population de la France
        (("couverture", 0, "part"), NAN),
        (("couverture", 0, "part_brute"), 101.0),
        (("couverture", 0, "part_brute"), -1.0),
        (("choix", 0, "seuil"), NAN),
        (("choix", 0, "n_codes_conversion"), -1),
        (("choix", 0, "n_codes_conversion"), 10_001),
    ],
)
def test_plan_zone_refuse_les_nombres_hors_domaine(client: TestClient, chemin: tuple[Any, ...], valeur: float) -> None:
    lecteur = brancher(declinaison("strasbourg", "pondere-dv360-ttd"))
    reponse = _envoyer(client, "/v1/plans/zone", _poser(_zone(), chemin, valeur))
    _refus_francais(reponse, ".".join(str(x) for x in chemin))
    assert lecteur.ouvertures == 0  # refus AVANT toute connexion


def test_plan_zone_deux_unites_a_1e308_refusees_et_non_debordees(client: TestClient) -> None:
    brancher(declinaison("strasbourg", "pondere-dv360-ttd"))
    corps = _zone()
    corps["couverture"][0]["pop_en_zone"] = corps["couverture"][1]["pop_en_zone"] = 1e308
    assert _envoyer(client, "/v1/plans/zone", corps).status_code == 422


def test_plan_zone_litteral_1e400_lu_comme_infini_refuse(client: TestClient) -> None:
    brancher(declinaison("strasbourg", "pondere-dv360-ttd"))
    corps = _poser(_zone(), ("couverture", 0, "pop_en_zone"), 123456.0)
    texte = json.dumps(corps).replace("123456.0", "1e400", 1)
    reponse = client.post("/v1/plans/zone", headers={**ENTETE, "Content-Type": "application/json"}, content=texte)
    _refus_francais(reponse, "couverture.0.pop_en_zone")


def test_plan_zone_n_codes_conversion_obligatoire(client: TestClient) -> None:
    brancher(declinaison("strasbourg", "pondere-dv360-ttd"))
    corps = _zone()
    del corps["choix"][0]["n_codes_conversion"]
    reponse = _envoyer(client, "/v1/plans/zone", corps)
    _refus_francais(reponse, "choix.0.n_codes_conversion")
    assert "champ obligatoire absent" in reponse.json()["detail"]["message"]


@pytest.mark.parametrize("route", ["/v1/plans/zone", "/v1/plans/risque"])
def test_groupe_vide_ou_trop_grand_refuse(client: TestClient, route: str) -> None:
    # M1 : un groupe vide faisait diviser par zéro en `divise` (500) ; M2 : 200 000 membres étaient acceptés.
    brancher(declinaison("strasbourg", "pondere-dv360-ttd"))
    corps = _zone() if route.endswith("zone") else _risque()
    _refus_francais(_envoyer(client, route, {**corps, "groupes": {"A": []}}), "groupes.A")
    trop = {"A": [f"{i:05d}" for i in range(51)]}
    _refus_francais(_envoyer(client, route, {**corps, "groupes": trop}), "groupes.A")


@pytest.mark.parametrize(
    ("chemin", "valeur"),
    [
        (("cps", 0, "pop_en_zone"), NAN),
        (("cps", 0, "pop_en_zone"), -50.0),
        (("cps", 0, "pop_en_zone"), 1e308),
        (("cps", 0, "pop_totale"), INF),
        (("jeu", "poids", "zone"), INF),
        (("jeu", "poids", "zone"), NAN),
        (("jeu", "poids", "zone"), -1.0),
        (("jeu", "poids", "zone"), 6.0),  # POIDS_MAX = 5, comme `lib/zones/jeu.ts`
    ],
)
def test_plan_risque_refuse_les_nombres_hors_domaine(
    client: TestClient, chemin: tuple[Any, ...], valeur: float
) -> None:
    reponse = _envoyer(client, "/v1/plans/risque", _poser(_risque(), chemin, valeur))
    _refus_francais(reponse, ".".join(str(x) for x in chemin))


def test_json_illisible_refuse_en_francais(client: TestClient) -> None:
    reponse = client.post(
        "/v1/plans/risque", headers={**ENTETE, "Content-Type": "application/json"}, content=b'{"cps": ['
    )
    assert reponse.status_code == 422
    assert "JSON illisible" in reponse.json()["detail"]["message"]


def test_corps_annonce_trop_gros_413(client: TestClient) -> None:
    corps = b'{"cps": [' + b" " * (erreurs.MAX_CORPS_OCTETS + 1) + b"]}"
    reponse = client.post("/v1/plans/risque", headers={**ENTETE, "Content-Type": "application/json"}, content=corps)
    assert reponse.status_code == 413
    assert reponse.json()["detail"]["message"] == "Corps de requête trop gros : au plus 8 Mo."


def test_corps_par_morceaux_trop_gros_413(client: TestClient) -> None:
    # Sans Content-Length : compté au fil des morceaux.
    morceau = b" " * (1024 * 1024)

    def flux() -> Iterator[bytes]:
        yield b'{"cps": ['
        for _ in range(9):
            yield morceau
        yield b"]}"

    reponse = client.post("/v1/plans/risque", headers={**ENTETE, "Content-Type": "application/json"}, content=flux())
    assert reponse.status_code == 413


def test_corps_par_morceaux_sous_la_borne_passe(client: TestClient) -> None:
    texte = json.dumps(_risque()).encode()

    def flux() -> Iterator[bytes]:
        for i in range(0, len(texte), 4096):
            yield texte[i : i + 4096]

    reponse = client.post("/v1/plans/risque", headers={**ENTETE, "Content-Type": "application/json"}, content=flux())
    assert reponse.status_code == 200, reponse.text


def test_corps_invalide_rend_422_meme_base_coupee(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    # M4 : la connexion était empruntée AVANT la validation — base coupée, un corps invalide rendait 503.
    monkeypatch.setenv("OPTIMISATION_DATABASE_URL", "postgresql://u:x@127.0.0.1:1/postgres")
    monkeypatch.setattr(base, "DELAI_EMPRUNT_S", 0.5)
    base.fermer_pool()
    try:
        reponse = _envoyer(client, "/v1/plans/zone", {**_zone(), "mode_plan": "autre"})
    finally:
        base.fermer_pool()
    _refus_francais(reponse, "mode_plan")


def test_connexion_rendue_avant_le_calcul_et_calcul_sous_verrou(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    lecteur = brancher(declinaison("strasbourg", "pondere-dv360-ttd"))
    vu: list[tuple[bool, bool]] = []
    original = plans.plans_par_plateforme  # type: ignore[attr-defined]

    def espion(*args: Any, **kwargs: Any) -> Any:
        vu.append((lecteur.rendu, plans._verrou_calcul.locked()))
        return original(*args, **kwargs)

    monkeypatch.setattr(plans, "plans_par_plateforme", espion)
    assert client.post("/v1/plans/zone", headers=ENTETE, json=_zone()).status_code == 200
    assert lecteur.ouvertures == 1
    assert vu == [(True, True)]
    assert not plans._verrou_calcul.locked()


@pytest.mark.parametrize("route", ["/v1/plans/zone", "/v1/plans/risque"])
def test_un_calcul_a_la_fois_503_francais_si_occupe(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, route: str
) -> None:
    brancher(declinaison("strasbourg", "pondere-dv360-ttd"))
    monkeypatch.setattr(plans, "ATTENTE_CALCUL_S", 0.05)
    corps = _zone() if route.endswith("zone") else _risque()
    assert plans._verrou_calcul.acquire(timeout=1)
    try:
        reponse = client.post(route, headers=ENTETE, json=corps)
    finally:
        plans._verrou_calcul.release()
    assert reponse.status_code == 503
    assert reponse.json()["detail"]["message"] == plans.MESSAGE_OCCUPE
    assert client.post(route, headers=ENTETE, json=corps).status_code == 200


def test_erreur_imprevue_500_en_francais_sans_trace(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPTIMISATION_CLE_INTERNE", CLE)

    def panne(*_: Any, **__: Any) -> Any:
        raise RuntimeError("detail-interne-secret")

    monkeypatch.setattr(plans, "generer_plan_cp", panne)
    reponse = TestClient(app, raise_server_exceptions=False).post("/v1/plans/risque", headers=ENTETE, json=_risque())
    assert reponse.status_code == 500
    assert reponse.json()["detail"]["message"].startswith("Erreur interne du service d'optimisation")
    assert "detail-interne-secret" not in reponse.text and "RuntimeError" not in reponse.text
    assert not plans._verrou_calcul.locked()
