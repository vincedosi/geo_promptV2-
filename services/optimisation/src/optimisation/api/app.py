"""Application FastAPI. Lancement : `uvicorn optimisation.api.app:app --workers 1` (un calcul à la fois)."""

from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, FastAPI, Response, status
from pydantic import BaseModel

from optimisation import __version__, config
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
    application = FastAPI(
        title="dentsu.explore — service d'optimisation",
        version=__version__,
        dependencies=[Depends(exiger_cle)],
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

    return application


app = creer_app()
