"""`GET` / `PUT /v1/campagnes/{campagne_id}/reglages` : seuils d'alerte et corrections de données d'une campagne
(relecture de la phase 2, I3 — l'interrupteur qui manquait aux tâches 2.1-2.3).

Appelé par la passerelle Next `…/api/campaigns/[campaignId]/optimisation/reglages`, qui a vérifié la session, le droit
de régler la campagne et l'espace propriétaire (même règle que l'algorithme, `lib/optimisation/droit-algo.ts`). Le
service revérifie que la campagne appartient à `X-Espace` avant toute lecture ou écriture : sinon 404.

`PUT` : le corps `{ "parametres": {...} }` REMPLACE `optimisation_reglages.parametres` (clé absente = défaut d'avant).
Refus 422 en français AVANT toute connexion : clé inconnue, nombre en texte, seuil ≤ 0 ou au-delà de sa borne
(pourcentages ≤ 100, rythmes et facteur de CPM ≤ 10 — sql/350), ordre des seuils de rythme violé. La réponse dit si
`tableaux_depuis_plan` a changé (`tableaux_a_reconstruire`) : Next reconstruit alors les tableaux par CP.
"""

import json
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any, Literal, Protocol

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from optimisation import config
from optimisation.algos.registre import REGISTRE
from optimisation.api.reglages_algo import CampagneId, Role, Uuid, _base, _hors_espace
from optimisation.base import connexion, connexion_ecriture
from optimisation.ecriture.reglages_campagne import (
    EntreeJournalReglages,
    EtatReglages,
    ReglagesEtJournal,
    ResultatReglages,
    ecrire_reglages_campagne,
    json_exact,
    lire_brut,
    lire_reglages_campagne,
)
from optimisation.lecture.reglages import CampagneHorsEspace, ParametresOptimisation


class ChoixReglages(BaseModel):
    model_config = ConfigDict(extra="forbid")
    parametres: dict[str, Any] = Field(default_factory=dict)


class SeuilsSortie(BaseModel):
    rythme_retard: float
    rythme_retard_grave: float
    rythme_avance: float
    rythme_avance_grave: float
    cpm_depassement: float
    cp_sous_plan_pct: float
    fuite_pct: float
    ecart_signale_pct: float


class ParametresEffectifs(BaseModel):
    seuils: SeuilsSortie
    tableaux_depuis_plan: bool
    univers_methode_a: Literal["fige", "referentiel"]


class ReglagesDonnees(BaseModel):
    """`parametres` : ce qui est réglé (clés données seulement) ; `effectifs` : défauts compris."""

    campagne_id: str
    parametres: dict[str, Any]
    effectifs: ParametresEffectifs
    enregistre: bool
    maj_par: str | None
    maj_le: datetime | None


class EntreeJournalReglagesSortie(BaseModel):
    id: str
    modifie_par: str | None
    role_auteur: str | None
    modifie_le: datetime
    avant: dict[str, Any]
    apres: dict[str, Any]


class ReglagesDonneesEtJournal(BaseModel):
    reglages: ReglagesDonnees
    journal: list[EntreeJournalReglagesSortie]
    journal_tronque: bool


class ResultatReglagesDonnees(BaseModel):
    reglages: ReglagesDonnees
    change: bool
    entree: EntreeJournalReglagesSortie | None
    tableaux_a_reconstruire: bool


class Depot(Protocol):
    def lire(self, campagne: str, espace: str) -> ReglagesEtJournal: ...

    def ecrire(
        self, *, campagne: str, espace: str, utilisateur: str, role: str, brut: dict[str, Any]
    ) -> ResultatReglages: ...


def _version_algo(algo_id: str) -> int:
    """Version au catalogue de l'algorithme courant (journal). Un algorithme retiré du catalogue : 1 — le journal ne
    porte qu'un changement de réglages, l'algorithme n'y change pas."""
    algo = REGISTRE.get(algo_id)
    return algo.version if algo else 1


class DepotBase:
    def lire(self, campagne: str, espace: str) -> ReglagesEtJournal:
        with _base(), connexion(config.url_base()) as conn:
            return lire_reglages_campagne(conn, campagne, espace)

    def ecrire(self, **champs: Any) -> ResultatReglages:
        with _base(), connexion_ecriture(config.url_base()) as conn:
            return ecrire_reglages_campagne(conn, version_algo=_version_algo, **champs)


def obtenir_depot() -> Depot:
    return DepotBase()


# ── Validation et mise en forme ──────────────────────────────────────────────────────────────────────────────────────


def _message(erreur: dict[str, Any]) -> str:
    """Une erreur Pydantic en français (chemin de la clé, règle violée)."""
    chemin = ".".join(str(x) for x in erreur.get("loc", ())) or "parametres"
    contexte = erreur.get("ctx") or {}
    match erreur.get("type"):
        case "extra_forbidden":
            return f"Clé inconnue : « {chemin} »."
        case "greater_than":
            return f"« {chemin} » doit être strictement supérieur à {contexte.get('gt')}."
        case "less_than_equal":
            return f"« {chemin} » ne peut pas dépasser {contexte.get('le')}."
        case "literal_error":
            return f"« {chemin} » : valeur non reconnue (attendu : {contexte.get('expected')})."
        case "value_error":
            return str(contexte.get("error") or erreur.get("msg"))
        case _:
            return f"« {chemin} » : type ou valeur invalide."


def valider(brut_entrant: dict[str, Any]) -> dict[str, Any]:
    """Le corps relu SANS flottant (`Decimal`), puis validé ; 422 en français avant toute connexion."""
    brut = lire_brut(json.dumps(brut_entrant))
    try:
        ParametresOptimisation.model_validate(lire_brut(json_exact(brut)))
    except ValidationError as erreur:
        raise HTTPException(
            status_code=422,
            detail={"refus": "parametre_invalide", "message": " ".join(_message(dict(e)) for e in erreur.errors())},
        ) from erreur
    return brut


def _en_json(valeur: Any) -> Any:
    """Les `Decimal` en nombres JSON (flottants), le reste tel quel."""
    if isinstance(valeur, Decimal):
        return float(valeur)
    if isinstance(valeur, dict):
        return {k: _en_json(v) for k, v in valeur.items()}
    return valeur


def _reglages(campagne: str, e: EtatReglages) -> ReglagesDonnees:
    eff = e.effectifs
    return ReglagesDonnees(
        campagne_id=campagne,
        parametres=_en_json(e.brut),
        effectifs=ParametresEffectifs(
            seuils=SeuilsSortie(**{k: float(v) for k, v in eff.seuils.model_dump().items()}),
            tableaux_depuis_plan=eff.tableaux_depuis_plan,
            univers_methode_a=eff.univers_methode_a,
        ),
        enregistre=e.enregistre,
        maj_par=e.maj_par,
        maj_le=e.maj_le,
    )


def _entree(j: EntreeJournalReglages) -> EntreeJournalReglagesSortie:
    return EntreeJournalReglagesSortie(
        id=j.id,
        modifie_par=j.modifie_par,
        role_auteur=j.role_auteur,
        modifie_le=j.modifie_le,
        avant=_en_json(j.avant),
        apres=_en_json(j.apres),
    )


routeur = APIRouter(prefix="/v1/campagnes")


@routeur.get("/{campagne_id}/reglages")
def lire_reglages_donnees(
    campagne_id: CampagneId,
    x_espace: Annotated[Uuid, Header()],
    depot: Annotated[Depot, Depends(obtenir_depot)],
) -> ReglagesDonneesEtJournal:
    """Les réglages de données courants (défauts sans ligne) et les 50 derniers changements, du plus récent."""
    try:
        lu = depot.lire(campagne_id, x_espace)
    except CampagneHorsEspace as erreur:
        raise _hors_espace() from erreur
    return ReglagesDonneesEtJournal(
        reglages=_reglages(campagne_id, lu.etat),
        journal=[_entree(j) for j in lu.journal],
        journal_tronque=lu.journal_tronque,
    )


@routeur.put("/{campagne_id}/reglages")
def regler_reglages_donnees(
    campagne_id: CampagneId,
    choix: ChoixReglages,
    x_espace: Annotated[Uuid, Header()],
    x_utilisateur: Annotated[Uuid, Header()],
    x_role: Annotated[Role, Header()],
    depot: Annotated[Depot, Depends(obtenir_depot)],
) -> ResultatReglagesDonnees:
    """Remplace les réglages de données de la campagne ; changement tracé au journal (`nature = 'reglages'`)."""
    brut = valider(choix.parametres)
    try:
        r = depot.ecrire(campagne=campagne_id, espace=x_espace, utilisateur=x_utilisateur, role=x_role, brut=brut)
    except CampagneHorsEspace as erreur:
        raise _hors_espace() from erreur
    return ResultatReglagesDonnees(
        reglages=_reglages(campagne_id, r.etat),
        change=r.change,
        entree=_entree(r.entree) if r.entree else None,
        tableaux_a_reconstruire=r.tableaux_a_reconstruire,
    )
