"""`GET` / `PUT /v1/campagnes/{id}/reglages` (relecture de la phase 2, I3) : refus 422 en français AVANT toute écriture
(clé inconnue, nombre en texte, bornes de sql/350, ordre des rythmes), 404 hors espace, en-têtes d'identité exigés,
nombres relus sans flottant, forme des réponses. La base est remplacée par un dépôt en mémoire (la vraie écriture :
`tests/ecriture/test_reglages_campagne.py`)."""

from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient

from optimisation.api.app import creer_app
from optimisation.api.reglages_donnees import obtenir_depot
from optimisation.ecriture.reglages_campagne import (
    EntreeJournalReglages,
    EtatReglages,
    ReglagesEtJournal,
    ResultatReglages,
    json_exact,
)
from optimisation.lecture.reglages import CampagneHorsEspace, ParametresOptimisation, parametres_depuis_json
from tests.api.test_plans import CLE, ENTETE

CAMPAGNE = "dccc0000-0000-4000-8000-000000000002"
ESPACE = "00000000-0000-0000-0000-000000000001"
AUTRE = "83cae295-9239-44b5-bb12-7a8b23448b01"
UTILISATEUR = "11111111-2222-4333-8444-555555555555"
QUAND = datetime(2026, 11, 5, 9, 30, tzinfo=UTC)
CHEMIN = f"/v1/campagnes/{CAMPAGNE}/reglages"
IDENTITE = {**ENTETE, "X-Espace": ESPACE, "X-Utilisateur": UTILISATEUR, "X-Role": "admin"}


@dataclass
class DepotMemoire:
    brut: dict[str, Any] = field(default_factory=dict)
    ecritures: list[dict[str, Any]] = field(default_factory=list)

    def _etat(self) -> EtatReglages:
        return EtatReglages(dict(self.brut), parametres_depuis_json(json_exact(self.brut)), bool(self.brut), None, None)

    def lire(self, campagne: str, espace: str) -> ReglagesEtJournal:
        if (campagne, espace) != (CAMPAGNE, ESPACE):
            raise CampagneHorsEspace(campagne)
        return ReglagesEtJournal(self._etat(), [], journal_tronque=False)

    def ecrire(self, **champs: Any) -> ResultatReglages:
        if (champs["campagne"], champs["espace"]) != (CAMPAGNE, ESPACE):
            raise CampagneHorsEspace(champs["campagne"])
        self.ecritures.append(champs)
        avant = self._etat()
        self.brut = champs["brut"]
        entree = EntreeJournalReglages("e1", champs["utilisateur"], champs["role"], QUAND, avant.brut, self.brut)
        apres = self._etat()
        bascule = avant.effectifs.tableaux_depuis_plan != apres.effectifs.tableaux_depuis_plan
        return ResultatReglages(apres, change=True, entree=entree, tableaux_a_reconstruire=bascule)


@pytest.fixture
def depot() -> DepotMemoire:
    return DepotMemoire()


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, depot: DepotMemoire) -> Iterator[TestClient]:
    monkeypatch.setenv("OPTIMISATION_CLE_INTERNE", CLE)

    def aucune_base(*_a: Any, **_k: Any) -> Any:
        raise AssertionError("le dépôt en mémoire remplace la base")

    monkeypatch.setattr("psycopg.connect", aucune_base)
    application = creer_app()
    application.dependency_overrides[obtenir_depot] = lambda: depot
    yield TestClient(application, raise_server_exceptions=False)


def test_sans_cle_401(client: TestClient) -> None:
    assert client.get(CHEMIN, headers={"X-Espace": ESPACE}).status_code == 401


def test_lecture_defauts(client: TestClient) -> None:
    r = client.get(CHEMIN, headers={**ENTETE, "X-Espace": ESPACE})
    assert r.status_code == 200
    reglages = r.json()["reglages"]
    assert reglages["parametres"] == {} and reglages["enregistre"] is False
    assert reglages["effectifs"]["seuils"]["cp_sous_plan_pct"] == 70
    assert reglages["effectifs"]["seuils"]["ecart_signale_pct"] == 20
    assert reglages["effectifs"]["tableaux_depuis_plan"] is False
    assert reglages["effectifs"]["univers_methode_a"] == "fige"


def test_hors_espace_404(client: TestClient) -> None:
    assert client.get(CHEMIN, headers={**ENTETE, "X-Espace": AUTRE}).status_code == 404
    corps = {"parametres": {"tableaux_depuis_plan": True}}
    assert client.put(CHEMIN, headers={**IDENTITE, "X-Espace": AUTRE}, json=corps).status_code == 404


def test_reglage_ecrit_sans_flottant(client: TestClient, depot: DepotMemoire) -> None:
    corps = {"parametres": {"seuils": {"rythme_retard": 0.85, "ecart_signale_pct": 30}, "tableaux_depuis_plan": True}}
    r = client.put(CHEMIN, headers=IDENTITE, json=corps)
    assert r.status_code == 200, r.text
    sortie = r.json()
    assert sortie["change"] is True and sortie["tableaux_a_reconstruire"] is True
    assert sortie["reglages"]["effectifs"]["seuils"]["ecart_signale_pct"] == 30
    assert sortie["entree"]["avant"] == {} and sortie["entree"]["apres"] == corps["parametres"]
    (ecrit,) = depot.ecritures
    assert ecrit["brut"]["seuils"]["rythme_retard"] == Decimal("0.85")  # jamais 0.84999…
    assert (ecrit["utilisateur"], ecrit["role"]) == (UTILISATEUR, "admin")


@pytest.mark.parametrize(
    ("parametres", "extrait"),
    [
        ({"seuils": {"cp_sous_plan": 50}}, "Clé inconnue"),
        ({"autre": 1}, "Clé inconnue"),
        ({"seuils": {"rythme_retard": "0.8"}}, "type ou valeur invalide"),
        ({"seuils": {"fuite_pct": 0}}, "strictement supérieur à 0"),
        ({"seuils": {"cp_sous_plan_pct": 100.5}}, "ne peut pas dépasser 100"),
        ({"seuils": {"cpm_depassement": 11}}, "ne peut pas dépasser 10"),
        ({"seuils": {"rythme_retard_grave": 0.9}}, "retard grave"),
        ({"univers_methode_a": "livraison"}, "valeur non reconnue"),
        ({"tableaux_depuis_plan": "oui"}, "type ou valeur invalide"),
    ],
)
def test_refus_422_avant_ecriture(
    client: TestClient, depot: DepotMemoire, parametres: dict[str, Any], extrait: str
) -> None:
    r = client.put(CHEMIN, headers=IDENTITE, json={"parametres": parametres})
    assert r.status_code == 422, r.text
    detail = r.json()["detail"]
    assert detail["refus"] == "parametre_invalide" and extrait in detail["message"], detail
    assert depot.ecritures == []


def test_identite_exigee(client: TestClient) -> None:
    sans_role = {k: v for k, v in IDENTITE.items() if k != "X-Role"}
    assert client.put(CHEMIN, headers=sans_role, json={"parametres": {}}).status_code == 422


def test_defauts_valides(client: TestClient) -> None:
    assert ParametresOptimisation() == parametres_depuis_json("{}")
