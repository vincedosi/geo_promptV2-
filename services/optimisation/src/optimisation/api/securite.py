"""En-tête `X-Optimisation-Cle` : la clé de la passerelle Next, comparée à temps constant."""

import hmac
from typing import Annotated

from fastapi import Header, HTTPException, status

from optimisation import config


def exiger_cle(x_optimisation_cle: Annotated[str | None, Header()] = None) -> None:
    """Dépendance de toutes les routes.

    Clé non configurée côté service → 503 : un service sans clé est mal déployé, il ne doit pas
    s'ouvrir à tout le monde. Clé absente ou fausse → 401, même réponse dans les deux cas.
    """
    attendue = config.cle_interne()
    if attendue is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service d'optimisation mal configuré : OPTIMISATION_CLE_INTERNE absente.",
        )
    # Normalisée comme la clé attendue (`config.cle_interne` retire les blancs) : une clé recopiée avec un espace final
    # d'un côté seulement ne doit pas produire un 401 incompréhensible (relecture A, M4).
    recue = (x_optimisation_cle or "").strip()
    if not hmac.compare_digest(recue.encode("utf-8"), attendue.encode("utf-8")):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Clé interne absente ou invalide.")
