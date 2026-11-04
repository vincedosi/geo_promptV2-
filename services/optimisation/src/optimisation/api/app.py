"""Application FastAPI. Lancement : `uvicorn optimisation.api.app:app --workers 1`.

Un seul processus ; DANS ce processus, les routes `def` tournent sur le pool de threads d'anyio. « Un calcul à la
fois » est donc tenu par un verrou autour du calcul pur (`api/plans.py`, `verrou_calcul`), pas par `--workers 1`
seul (relecture B, M4).
"""

from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, FastAPI, Response, status
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel

from optimisation import __version__, config
from optimisation.api.erreurs import LimiteCorps, erreur_imprevue, refus_de_validation
from optimisation.api.plans import routeur as routeur_plans
from optimisation.api.securite import exiger_cle
from optimisation.base import EtatBase, sonder_base


class SanteBase(BaseModel):
    ok: bool
    role: str | None = None
    erreur: str | None = None


class Sante(BaseModel):
    service: str
    version: str
    base: SanteBase


def _sonde_par_defaut() -> EtatBase:
    return sonder_base(config.url_base())


def obtenir_sonde() -> Callable[[], EtatBase]:
    """Dépendance remplaçable en test (`app.dependency_overrides`)."""
    return _sonde_par_defaut


def creer_app() -> FastAPI:
    # Pas de /docs, /redoc ni /openapi.json servis : les routes de documentation de FastAPI échappent aux dépendances
    # d'application, donc à la clé (relecture A, M1). Le schéma reste produit par `application.openapi()`, que le test
    # d'export utilisera (plan § 3.2).
    application = FastAPI(
        title="dentsu.explore — service d'optimisation",
        version=__version__,
        dependencies=[Depends(exiger_cle)],
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @application.get("/sante")
    def sante(response: Response, sonde: Annotated[Callable[[], EtatBase], Depends(obtenir_sonde)]) -> Sante:
        """Service et base. 200 si la base répond, 503 sinon (le corps dit pourquoi)."""
        etat = sonde()
        if not etat.ok:
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return Sante(
            service="ok",
            version=__version__,
            base=SanteBase(ok=etat.ok, role=etat.role, erreur=etat.erreur),
        )

    application.include_router(routeur_plans)
    application.add_exception_handler(RequestValidationError, refus_de_validation)
    application.add_exception_handler(Exception, erreur_imprevue)
    application.add_middleware(LimiteCorps)
    return application


app = creer_app()
