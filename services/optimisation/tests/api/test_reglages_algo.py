"""`GET` / `PUT /v1/campagnes/{id}/algo` (tâche 2.7) : refus 422 du catalogue AVANT toute écriture, 404 hors espace,
en-têtes d'identité exigés, forme des réponses. La base est remplacée par un dépôt en mémoire (la vraie écriture est
testée contre la base locale dans `tests/ecriture/test_algo_campagne.py`)."""

from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from optimisation.api.app import creer_app
from optimisation.api.reglages_algo import obtenir_depot
from optimisation.ecriture.algo_campagne import EntreeJournal, EtatAlgo, EtatEtJournal, ResultatEcriture
from optimisation.lecture.reglages import CampagneHorsEspace
from tests.api.test_plans import CLE, ENTETE

CAMPAGNE = "dccc0000-0000-4000-8000-000000000002"
ESPACE = "00000000-0000-0000-0000-000000000001"
AUTRE = "83cae295-9239-44b5-bb12-7a8b23448b01"
UTILISATEUR = "11111111-2222-4333-8444-555555555555"
QUAND = datetime(2026, 11, 5, 9, 30, tzinfo=UTC)
CHEMIN = f"/v1/campagnes/{CAMPAGNE}/algo"
IDENTITE = {**ENTETE, "X-Espace": ESPACE, "X-Utilisateur": UTILISATEUR, "X-Role": "admin"}


@dataclass
class DepotMemoire:
    """Une campagne dans un espace ; mémorise chaque écriture demandée."""

    algo: str = "uniformiser_global"
    surcharges: dict[str, float] = field(default_factory=dict)
    enregistre: bool = False
    ecritures: list[dict[str, Any]] = field(default_factory=list)
    journal: list[EntreeJournal] = field(default_factory=list)

    def _etat(self) -> EtatAlgo:
        return EtatAlgo(
            self.algo,
            dict(self.surcharges),
            self.enregistre,
            UTILISATEUR if self.enregistre else None,
            QUAND if self.enregistre else None,
        )

    def lire(self, campagne: str, espace: str) -> EtatEtJournal:
        if (campagne, espace) != (CAMPAGNE, ESPACE):
            raise CampagneHorsEspace(campagne)
        return EtatEtJournal(self._etat(), list(self.journal), journal_tronque=False)

    def ecrire(self, **champs: Any) -> ResultatEcriture:
        if (champs["campagne"], champs["espace"]) != (CAMPAGNE, ESPACE):
            raise CampagneHorsEspace(champs["campagne"])
        self.ecritures.append(champs)
        if champs["algo_id"] == self.algo and champs["surcharges"] == self.surcharges:
            return ResultatEcriture(self._etat(), change=False, entree=None)
        entree = EntreeJournal(
            id="e1",
            modifie_par=champs["utilisateur"],
            role_auteur=champs["role"],
            modifie_le=QUAND,
            algo_avant=self.algo,
            parametres_avant=dict(self.surcharges),
            algo_apres=champs["algo_id"],
            algo_version_apres=champs["algo_version"],
            parametres_apres=dict(champs["surcharges"]),
        )
        self.algo, self.surcharges, self.enregistre = champs["algo_id"], dict(champs["surcharges"]), True
        self.journal.insert(0, entree)
        return ResultatEcriture(self._etat(), change=True, entree=entree)


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


def test_lecture_sans_reglage_rend_le_defaut(client: TestClient) -> None:
    r = client.get(CHEMIN, headers={**ENTETE, "X-Espace": ESPACE})
    assert r.status_code == 200
    corps = r.json()
    reglage = corps["reglage"]
    assert reglage["algo_id"] == "uniformiser_global"
    assert reglage["enregistre"] is False and reglage["surcharges"] == {}
    assert reglage["libelle"] == "Uniformiser au global" and reglage["etat"] == "a_venir"
    assert reglage["parametres_effectifs"]["alpha"] == 0.5
    assert reglage["parametres_effectifs"]["tolerance_global"] == 10.0
    assert corps["journal"] == [] and corps["journal_tronque"] is False


def test_lecture_hors_espace_404(client: TestClient) -> None:
    r = client.get(CHEMIN, headers={**ENTETE, "X-Espace": AUTRE})
    assert r.status_code == 404
    assert r.json()["detail"] == {"refus": "hors_espace", "message": "Campagne introuvable dans cet espace."}


def test_changement_ecrit_et_trace(client: TestClient, depot: DepotMemoire) -> None:
    r = client.put(CHEMIN, headers=IDENTITE, json={"algo_id": "uniformiser_par_regie", "parametres": {"alpha": 0.4}})
    assert r.status_code == 200, r.text
    corps = r.json()
    assert corps["change"] is True
    assert corps["reglage"]["algo_id"] == "uniformiser_par_regie"
    assert corps["reglage"]["surcharges"] == {"alpha": 0.4}
    assert corps["reglage"]["parametres_effectifs"]["alpha"] == 0.4
    assert "tolerance_global" not in corps["reglage"]["parametres_effectifs"]
    assert corps["entree"]["algo_avant"] == "uniformiser_global"
    assert corps["entree"]["algo_apres"] == "uniformiser_par_regie"
    assert corps["entree"]["algo_version_apres"] == 1
    assert corps["entree"]["modifie_par"] == UTILISATEUR and corps["entree"]["role_auteur"] == "admin"
    assert depot.ecritures == [
        {
            "campagne": CAMPAGNE,
            "espace": ESPACE,
            "utilisateur": UTILISATEUR,
            "role": "admin",
            "algo_id": "uniformiser_par_regie",
            "algo_version": 1,
            "surcharges": {"alpha": 0.4},
        }
    ]
    # Le GET suivant rend le nouveau réglage et la ligne de journal.
    lu = client.get(CHEMIN, headers=IDENTITE).json()
    assert lu["reglage"]["algo_id"] == "uniformiser_par_regie"
    assert [e["algo_apres"] for e in lu["journal"]] == ["uniformiser_par_regie"]


def test_retour_au_global_en_cours_de_campagne_autorise(client: TestClient) -> None:
    """Décision du propriétaire du 05/11 : le changement en cours de campagne est permis, dans les deux sens."""
    assert client.put(CHEMIN, headers=IDENTITE, json={"algo_id": "uniformiser_par_regie"}).json()["change"] is True
    r = client.put(CHEMIN, headers=IDENTITE, json={"algo_id": "uniformiser_global"})
    assert r.status_code == 200 and r.json()["change"] is True
    assert r.json()["entree"]["algo_avant"] == "uniformiser_par_regie"


def test_meme_choix_ne_change_rien(client: TestClient) -> None:
    r = client.put(CHEMIN, headers=IDENTITE, json={"algo_id": "uniformiser_global"})
    assert r.status_code == 200
    assert r.json()["change"] is False and r.json()["entree"] is None


@pytest.mark.parametrize(
    ("corps", "refus", "extrait"),
    [
        ({"algo_id": "inexistant"}, "algo_inconnu", "Algorithme inconnu : « inexistant »"),
        ({"algo_id": "rebid_plafonne"}, "algo_non_proposable", "réservé au simulateur"),
        ({"algo_id": "recalage_amorti"}, "algo_non_proposable", "réservé au simulateur"),
        ({"algo_id": "plan_donnee_insee"}, "algo_autre_famille", "n'est pas de la famille « correction »"),
        ({"algo_id": "plan_jeu_de_zones"}, "algo_autre_famille", "n'est pas de la famille « correction »"),
        ({"algo_id": "uniformiser_global", "parametres": {"alpha": 2}}, "parametre_invalide", "hors des bornes"),
        ({"algo_id": "uniformiser_global", "parametres": {"alpha": 0.05}}, "parametre_invalide", "hors des bornes"),
        ({"algo_id": "uniformiser_global", "parametres": {"inconnu": 1}}, "parametre_invalide", "Paramètre inconnu"),
        ({"algo_id": "uniformiser_global", "parametres": {"fenetre_jours": 4.5}}, "parametre_invalide", "entier"),
        (
            {"algo_id": "uniformiser_global", "parametres": {"coefficient_min": 1.0, "coefficient_max": 1.0}},
            None,
            None,
        ),
        (
            {"algo_id": "uniformiser_global", "parametres": {"fenetre_min_jours": 7, "fenetre_jours": 5}},
            "parametre_invalide",
            "dépasse",
        ),
        ({"algo_id": "uniformiser_par_regie", "parametres": {"tolerance_global": 5}}, "parametre_invalide", "inconnu"),
    ],
)
def test_refus_du_catalogue_avant_toute_ecriture(
    client: TestClient, depot: DepotMemoire, corps: dict[str, Any], refus: str | None, extrait: str | None
) -> None:
    r = client.put(CHEMIN, headers=IDENTITE, json=corps)
    if refus is None:  # bornes égales : permis (ordre « ≤ »)
        assert r.status_code == 200, r.text
        return
    assert r.status_code == 422, r.text
    detail = r.json()["detail"]
    assert detail["refus"] == refus and detail["algo_id"] == corps["algo_id"]
    assert extrait is not None and extrait in detail["message"]
    assert depot.ecritures == []


@pytest.mark.parametrize(
    "corps",
    [
        {},
        {"algo_id": ""},
        {"algo_id": "uniformiser_global", "autre": 1},
        {"algo_id": "uniformiser_global", "parametres": {"alpha": "0.5"}},
        {"algo_id": "uniformiser_global", "parametres": {"alpha": True}},
        {"algo_id": "uniformiser_global", "parametres": [0.5]},
    ],
)
def test_corps_invalide_422_validation(client: TestClient, depot: DepotMemoire, corps: dict[str, Any]) -> None:
    r = client.put(CHEMIN, headers=IDENTITE, json=corps)
    assert r.status_code == 422
    assert r.json()["detail"]["refus"] == "validation"
    assert depot.ecritures == []


@pytest.mark.parametrize("manque", ["X-Espace", "X-Utilisateur", "X-Role"])
def test_identite_exigee_en_ecriture(client: TestClient, depot: DepotMemoire, manque: str) -> None:
    entetes = {k: v for k, v in IDENTITE.items() if k != manque}
    r = client.put(CHEMIN, headers=entetes, json={"algo_id": "uniformiser_par_regie"})
    assert r.status_code == 422
    assert depot.ecritures == []


def test_role_inconnu_ou_identifiant_mal_forme_refuses(client: TestClient, depot: DepotMemoire) -> None:
    assert (
        client.put(CHEMIN, headers={**IDENTITE, "X-Role": "editor"}, json={"algo_id": "uniformiser_par_regie"})
    ).status_code == 422
    assert (
        client.put(CHEMIN, headers={**IDENTITE, "X-Espace": "pas-un-uuid"}, json={"algo_id": "uniformiser_par_regie"})
    ).status_code == 422
    assert client.get("/v1/campagnes/pas-un-uuid/algo", headers=IDENTITE).status_code == 422
    assert depot.ecritures == []


def test_ecriture_hors_espace_404(client: TestClient, depot: DepotMemoire) -> None:
    r = client.put(CHEMIN, headers={**IDENTITE, "X-Espace": AUTRE}, json={"algo_id": "uniformiser_par_regie"})
    assert r.status_code == 404
    assert r.json()["detail"]["refus"] == "hors_espace"
    assert depot.journal == []


def test_algo_enregistre_retire_du_catalogue(client: TestClient, depot: DepotMemoire) -> None:
    depot.algo, depot.enregistre = "retire_depuis", True
    reglage = client.get(CHEMIN, headers=IDENTITE).json()["reglage"]
    assert reglage["algo_id"] == "retire_depuis"
    assert (reglage["algo_version"], reglage["libelle"], reglage["parametres_effectifs"]) == (None, None, None)
