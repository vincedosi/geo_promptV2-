"""`GET /v1/algos` : le catalogue d'algorithmes tel quel (plan § 16.1, tâche 2.6). AUCUNE lecture en base.

Filtres `famille` (`plan` | `correction`) et `proposable` (`true` | `false`). Next le relaie par
`GET /api/optimisation/algos` pour l'écran ⑦ ; la clé interne est exigée comme partout (dépendance d'application).

Les refus du catalogue (`AlgoInconnu`, `AlgoAVenir`, `ParametreInvalide`) deviennent un 422 français
`{detail: {refus, algo_id, message}}` — le même gabarit que le refus « mode abandonné ».
"""

from typing import Literal

from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from optimisation.algos.contrat import Algorithme, RefusAlgo
from optimisation.algos.registre import ALGO_CORRECTION_DEFAUT, catalogue


class ParametreAlgo(BaseModel):
    nom: str
    libelle: str
    defaut: float
    minimum: float
    maximum: float
    unite: str
    entier: bool


class AlgoCatalogue(BaseModel):
    id: str
    version: int
    libelle: str
    description: str
    familles: list[Literal["plan", "correction"]]
    proposable: bool
    etat: Literal["disponible", "a_venir"]
    parametres: list[ParametreAlgo]
    ordres: list[tuple[str, str]]


class CatalogueAlgos(BaseModel):
    algos: list[AlgoCatalogue]
    defaut_correction: str


def _en_modele(a: Algorithme) -> AlgoCatalogue:
    return AlgoCatalogue(
        id=a.id,
        version=a.version,
        libelle=a.libelle,
        description=a.description,
        familles=list(a.familles),
        proposable=a.proposable,
        etat=a.etat,
        parametres=[
            ParametreAlgo(
                nom=p.nom,
                libelle=p.libelle,
                defaut=p.defaut,
                minimum=p.minimum,
                maximum=p.maximum,
                unite=p.unite,
                entier=p.entier,
            )
            for p in a.parametres
        ],
        ordres=list(a.ordres),
    )


routeur = APIRouter(prefix="/v1")


@routeur.get("/algos")
def lister_algos(
    famille: Literal["plan", "correction"] | None = None, proposable: bool | None = None
) -> CatalogueAlgos:
    """Le catalogue, filtré. Sans lecture en base : il vit dans le code (`algos/registre.py`)."""
    return CatalogueAlgos(
        algos=[_en_modele(a) for a in catalogue(famille, proposable)],
        defaut_correction=ALGO_CORRECTION_DEFAUT,
    )


async def refus_algo(_requete: Request, erreur: Exception) -> JSONResponse:
    """Algorithme inconnu, à venir, ou paramètre invalide : 422 en français, jamais un calcul de remplacement."""
    if not isinstance(erreur, RefusAlgo):  # enregistré pour cette seule classe
        raise erreur
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={"detail": {"refus": erreur.refus, "algo_id": erreur.algo_id, "message": erreur.message}},
    )
