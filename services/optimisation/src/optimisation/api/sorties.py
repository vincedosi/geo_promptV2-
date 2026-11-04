"""Schéma des SORTIES des routes, pour l'OpenAPI seulement (tâche 1.6).

Les routes rendent un `ReponseJson` construit à la main (entiers sans décimale, clés dans l'ordre du TS) : ces modèles
ne valident ni ne transforment rien à l'exécution. Ils sont déclarés par `responses={200: {"model": …}}` pour que
`app.openapi()` décrive ce que Next reçoit ; `tests/api/test_openapi.py` exporte ce schéma dans
`services/optimisation/openapi.json`, d'où sont générés les types TS (`lib/optimisation/types-openapi.ts`). Côté Next,
la réponse est revalidée par Zod (`lib/optimisation/schemas.ts`) : le schéma décrit, Zod contrôle.

Les champs reprennent les `TypedDict` du noyau (`noyau/types.py`) : une sortie qui change de forme change le schéma,
donc `openapi.json`, et le test d'export échoue tant que le fichier et les types TS ne sont pas régénérés.
"""

from typing import Literal, NotRequired, TypedDict

from pydantic import BaseModel, ConfigDict

from optimisation.noyau.types import (
    AvertissementPoids,
    BilanMultiplicateur,
    LignePlan,
    LignePlanZone,
    PlanZone,
    RegleGroupe,
    ResumePlanZone,
    SortiePoids,
)


class Algo(TypedDict):
    """Moteur, version et sha256 du JSON canonique des entrées : rejouer ces entrées rend le même résultat."""

    moteur: Literal["python"]
    version: str
    entrees_sha256: str


class BornesSortie(TypedDict):
    min: float
    max: float


class AVerifierSortie(TypedDict):
    min: bool
    max: bool


class Reglage(TypedDict):
    """`ReglagePlan` tel que le TS l'écrit : clés absentes omises."""

    bornes: NotRequired[BornesSortie]
    poids_groupe_cp: NotRequired[RegleGroupe]
    a_verifier: NotRequired[AVerifierSortie]


class ResumeCommun(ResumePlanZone):
    """Le résumé du plan commun, `algo` compris (`resume_plan.algo`, sql/344)."""

    algo: Algo


class PlanCommun(TypedDict):
    lignes: list[LignePlanZone]
    resume: ResumeCommun


class PlanParPlateforme(TypedDict):
    plateforme: str
    seuil: float
    reglage: Reglage
    plan: PlanZone
    poids: list[SortiePoids]
    avertissements: list[AvertissementPoids]


class SortiesPoidsCommun(TypedDict):
    plateforme: str
    poids: list[SortiePoids]
    avertissements: list[AvertissementPoids]


class Sortie(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SortiePlanZone(Sortie):
    commun: PlanCommun
    reglage: Reglage
    par_plateforme: list[PlanParPlateforme]
    sorties_poids: list[SortiesPoidsCommun]
    algo: Algo


class SortiePlanRisque(Sortie):
    """`genererPlanCp` (sémantique `repartition`) + `algo`. `multiplicateur` (bilan d'écrêtage) n'est rendu qu'en
    sémantique `multiplicateur`, jamais par cette route : déclaré facultatif, comme dans le type TS."""

    lignes: list[LignePlan]
    part_plan_en_zone: float | None
    taux_utile: float | None
    n_retenus: int
    multiplicateur: BilanMultiplicateur | None = None
    algo: Algo


class SortieRecaler(Sortie):
    """`recaler` : les `Map` du TS en listes de paires, dans leur ordre d'insertion. Un code postal est une clé
    « numérique » : dans un objet JSON relu par JavaScript, il passerait en tête et l'ordre serait perdu."""

    multiplicateurs: list[tuple[str, float]]
    corrections: list[tuple[str, float]]
    dilues: list[str]
    algo: Algo
