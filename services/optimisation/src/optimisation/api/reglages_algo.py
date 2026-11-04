"""`GET` / `PUT /v1/campagnes/{campagne_id}/algo` : l'algorithme de correction d'une campagne (tâche 2.7, plan § 16.2).

Appelé par la passerelle Next `…/api/campaigns/[campaignId]/optimisation/algo`, qui a vérifié la session, le droit de
régler la campagne et l'espace propriétaire. Le service lui fait confiance pour l'IDENTITÉ (`X-Utilisateur`,
`X-Role`) et revérifie que la campagne appartient à `X-Espace` avant toute lecture ou écriture (plan § 5) : sinon 404,
sans dire si la campagne existe.

`PUT` : refus 422 en français, AVANT toute écriture — algorithme inconnu, d'une autre famille que `correction`,
réservé au simulateur (`proposable: false`), paramètre inconnu / hors bornes / non entier / ordre violé. Un algorithme
« à venir » peut être choisi (le défaut l'est) : rien n'est calculé ici, l'effet est au cycle suivant. Le corps porte
les SURCHARGES complètes (remplacement, pas fusion) : changer d'algorithme sans en donner repart des défauts du nouveau.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from typing import Annotated, Any, Literal, Protocol

from fastapi import APIRouter, Depends, Header, HTTPException, Path, status
from pydantic import BaseModel, ConfigDict, Field, StrictFloat

from optimisation import config
from optimisation.algos.contrat import RefusAlgo, parametres_effectifs
from optimisation.algos.registre import REGISTRE, valider_choix_correction
from optimisation.base import BaseIndisponible, connexion, connexion_ecriture
from optimisation.ecriture.algo_campagne import (
    EntreeJournal,
    EtatAlgo,
    EtatEtJournal,
    ResultatEcriture,
    ecrire_algo_campagne,
    lire_algo_campagne,
)
from optimisation.lecture.reglages import CampagneHorsEspace

MESSAGE_INDISPONIBLE = "Base de données indisponible : le réglage n'a pas pu être lu ni écrit."
MESSAGE_HORS_ESPACE = "Campagne introuvable dans cet espace."
MAX_SURCHARGES = 50

Uuid = Annotated[str, Field(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")]
Role = Literal["super_admin", "admin", "client"]
NomParametre = Annotated[str, Field(min_length=1, max_length=64)]
# Strict : un nombre écrit en texte ("0.5") ou un booléen est refusé ; NaN et ±∞ aussi.
Valeur = Annotated[StrictFloat, Field(allow_inf_nan=False)]


class ChoixAlgo(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    algo_id: str = Field(min_length=1, max_length=64)
    parametres: dict[NomParametre, Valeur] = Field(default_factory=dict, max_length=MAX_SURCHARGES)


class EntreeJournalSortie(BaseModel):
    id: str
    modifie_par: str | None
    role_auteur: str | None
    modifie_le: datetime
    algo_avant: str
    parametres_avant: dict[str, float]
    algo_apres: str
    algo_version_apres: int
    parametres_apres: dict[str, float]


class ReglageAlgo(BaseModel):
    """Le réglage courant. `algo_version`, `libelle`, `etat` et `parametres_effectifs` valent `None` si l'algorithme
    enregistré n'est plus au catalogue ; `parametres_effectifs` aussi si ses surcharges ne passent plus ses bornes."""

    campagne_id: str
    algo_id: str
    algo_version: int | None
    libelle: str | None
    etat: Literal["disponible", "a_venir"] | None
    surcharges: dict[str, float]
    parametres_effectifs: dict[str, float] | None
    enregistre: bool
    maj_par: str | None
    maj_le: datetime | None


class ReglageAlgoEtJournal(BaseModel):
    reglage: ReglageAlgo
    journal: list[EntreeJournalSortie]
    journal_tronque: bool


class ResultatReglageAlgo(BaseModel):
    reglage: ReglageAlgo
    change: bool
    entree: EntreeJournalSortie | None


# ── Accès à la base (remplaçable en test) ────────────────────────────────────────────────────────────────────────────


class Depot(Protocol):
    def lire(self, campagne: str, espace: str) -> EtatEtJournal: ...

    def ecrire(
        self,
        *,
        campagne: str,
        espace: str,
        utilisateur: str,
        role: str,
        algo_id: str,
        algo_version: int,
        surcharges: dict[str, float],
    ) -> ResultatEcriture: ...


class DepotBase:
    """Une connexion du pool par appel ; l'écriture est UNE transaction (validée à la sortie, annulée sur erreur)."""

    def lire(self, campagne: str, espace: str) -> EtatEtJournal:
        with _base(), connexion(config.url_base()) as conn:
            return lire_algo_campagne(conn, campagne, espace)

    def ecrire(self, **champs: Any) -> ResultatEcriture:
        with _base(), connexion_ecriture(config.url_base()) as conn:
            return ecrire_algo_campagne(conn, **champs)


@contextmanager
def _base() -> Iterator[None]:
    try:
        yield
    except BaseIndisponible as erreur:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"message": MESSAGE_INDISPONIBLE, "cause": str(erreur)},
        ) from erreur


def obtenir_depot() -> Depot:
    return DepotBase()


# ── Mise en forme ────────────────────────────────────────────────────────────────────────────────────────────────────


def _reglage(campagne: str, e: EtatAlgo) -> ReglageAlgo:
    algo = REGISTRE.get(e.algo_id)
    effectifs: dict[str, float] | None = None
    if algo is not None:
        try:
            effectifs = parametres_effectifs(algo, e.surcharges)
        except RefusAlgo:
            effectifs = None
    return ReglageAlgo(
        campagne_id=campagne,
        algo_id=e.algo_id,
        algo_version=algo.version if algo else None,
        libelle=algo.libelle if algo else None,
        etat=algo.etat if algo else None,
        surcharges=e.surcharges,
        parametres_effectifs=effectifs,
        enregistre=e.enregistre,
        maj_par=e.maj_par,
        maj_le=e.maj_le,
    )


def _entree(j: EntreeJournal) -> EntreeJournalSortie:
    return EntreeJournalSortie(
        id=j.id,
        modifie_par=j.modifie_par,
        role_auteur=j.role_auteur,
        modifie_le=j.modifie_le,
        algo_avant=j.algo_avant,
        parametres_avant=j.parametres_avant,
        algo_apres=j.algo_apres,
        algo_version_apres=j.algo_version_apres,
        parametres_apres=j.parametres_apres,
    )


def _hors_espace() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail={"refus": "hors_espace", "message": MESSAGE_HORS_ESPACE}
    )


routeur = APIRouter(prefix="/v1/campagnes")

CampagneId = Annotated[Uuid, Path()]


@routeur.get("/{campagne_id}/algo")
def lire_algo(
    campagne_id: CampagneId,
    x_espace: Annotated[Uuid, Header()],
    depot: Annotated[Depot, Depends(obtenir_depot)],
) -> ReglageAlgoEtJournal:
    """Le réglage courant (défaut du catalogue s'il n'y en a pas) et les 50 derniers changements, du plus récent."""
    try:
        lu = depot.lire(campagne_id, x_espace)
    except CampagneHorsEspace as erreur:
        raise _hors_espace() from erreur
    return ReglageAlgoEtJournal(
        reglage=_reglage(campagne_id, lu.etat),
        journal=[_entree(j) for j in lu.journal],
        journal_tronque=lu.journal_tronque,
    )


@routeur.put("/{campagne_id}/algo")
def regler_algo(
    campagne_id: CampagneId,
    choix: ChoixAlgo,
    x_espace: Annotated[Uuid, Header()],
    x_utilisateur: Annotated[Uuid, Header()],
    x_role: Annotated[Role, Header()],
    depot: Annotated[Depot, Depends(obtenir_depot)],
) -> ResultatReglageAlgo:
    """Choisit l'algorithme de correction de la campagne ; effet au cycle suivant ; changement tracé au journal.

    Le refus du catalogue (`RefusAlgo`, 422) part AVANT toute connexion : rien n'est lu ni écrit s'il est refusé."""
    algo, _effectifs = valider_choix_correction(choix.algo_id, choix.parametres)
    try:
        r = depot.ecrire(
            campagne=campagne_id,
            espace=x_espace,
            utilisateur=x_utilisateur,
            role=x_role,
            algo_id=algo.id,
            algo_version=algo.version,
            surcharges=dict(choix.parametres),
        )
    except CampagneHorsEspace as erreur:
        raise _hors_espace() from erreur
    return ResultatReglageAlgo(
        reglage=_reglage(campagne_id, r.etat),
        change=r.change,
        entree=_entree(r.entree) if r.entree else None,
    )
