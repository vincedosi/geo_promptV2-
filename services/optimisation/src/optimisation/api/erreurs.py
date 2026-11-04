"""Refus en français : validation des corps (422), mode abandonné (422), corps trop gros (413), erreur imprévue (500).

Relecture B (I1, M2, M3) : les 422 de Pydantic parlaient anglais (« Field required »), une valeur NaN ou ∞ passait la
validation puis faisait lever la sérialisation APRÈS le calcul (500 « Internal Server Error »), et aucun plafond ne
bornait la taille du corps. Tout refus a désormais la même forme que ceux des routes :
`{"detail": {"refus": …, "message": "<phrase française>"}}`.
"""

import logging
from collections.abc import Sequence
from typing import Any

from fastapi import Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from optimisation.noyau.pression import ModeAbandonne

journal = logging.getLogger("optimisation.api")

# Un plan national (≈ 6 100 unités CP, groupes compris) pèse ≈ 1 Mo en JSON (relecture B, M2). 8 Mo laissent huit
# fois cette marge ; au-delà, ce n'est plus un plan mais une erreur de l'appelant, refusée AVANT tout calcul.
MAX_CORPS_OCTETS = 8 * 1024 * 1024
MAX_ERREURS_RENDUES = 20

_MESSAGES: dict[str, str] = {
    "missing": "champ obligatoire absent",
    "extra_forbidden": "champ inconnu",
    "finite_number": "doit être un nombre fini (NaN et Infinity refusés)",
    "greater_than_equal": "doit être supérieur ou égal à {ge}",
    "greater_than": "doit être strictement supérieur à {gt}",
    "less_than_equal": "doit être inférieur ou égal à {le}",
    "less_than": "doit être strictement inférieur à {lt}",
    "too_short": "trop court : au moins {min_length} élément(s)",
    "too_long": "trop long : au plus {max_length} élément(s)",
    "string_too_short": "texte trop court : au moins {min_length} caractère(s)",
    "string_too_long": "texte trop long : au plus {max_length} caractère(s)",
    "json_invalid": "JSON illisible",
    "float_type": "doit être un nombre",
    "float_parsing": "doit être un nombre",
    "int_type": "doit être un entier",
    "int_parsing": "doit être un entier",
    "int_from_float": "doit être un entier",
    "string_type": "doit être un texte",
    "bool_type": "doit être un booléen",
    "bool_parsing": "doit être un booléen",
    "list_type": "doit être une liste",
    "dict_type": "doit être un objet",
    "model_type": "doit être un objet",
    "model_attributes_type": "doit être un objet",
    "literal_error": "valeur non permise, attendu : {expected}",
    "value_error": "valeur refusée",
}


def _champ(loc: Sequence[Any]) -> str:
    morceaux = [str(x) for x in loc if x != "body"]
    return ".".join(morceaux) if morceaux else "corps"


def _message(erreur: dict[str, Any]) -> str:
    modele = _MESSAGES.get(str(erreur.get("type")), "valeur invalide")
    try:
        return modele.format(**(erreur.get("ctx") or {}))
    except (KeyError, IndexError, ValueError):
        return modele.split(" {")[0]


def traduire(erreurs: Sequence[Any]) -> dict[str, Any]:
    """Le corps d'un 422 de validation : un message d'ensemble et, champ par champ, la raison en français."""
    details = [{"champ": _champ(e.get("loc", ())), "message": _message(e)} for e in erreurs[:MAX_ERREURS_RENDUES]]
    premier = details[0] if details else {"champ": "corps", "message": "valeur invalide"}
    message = f"Requête refusée — {premier['champ']} : {premier['message']}."
    if len(erreurs) > 1:
        message += f" ({len(erreurs)} erreurs au total.)"
    return {"refus": "validation", "message": message, "erreurs": details}


async def refus_de_validation(_requete: Request, erreur: Exception) -> JSONResponse:
    if not isinstance(erreur, RequestValidationError):  # enregistré pour cette seule classe
        raise erreur
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, content={"detail": traduire(erreur.errors())}
    )


async def refus_mode_abandonne(_requete: Request, erreur: Exception) -> JSONResponse:
    """`by_tier` / `by_subzone` : modes abandonnés le 05/11, jamais calculés. Sans ce refus, la méthode A partirait en
    500 « erreur imprévue » (relecture de phase 1, I2) alors que la demande est simplement hors catalogue."""
    if not isinstance(erreur, ModeAbandonne):  # enregistré pour cette seule classe
        raise erreur
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={
            "detail": {
                "refus": "mode_abandonne",
                "mode": erreur.mode,
                "message": (
                    f"Mode de pondération « {erreur.libelle} » abandonné : il n'est plus calculé. "
                    "Choisissez une pondération par donnée INSEE, uniforme ou par liste de codes postaux."
                ),
            }
        },
    )


async def erreur_imprevue(_requete: Request, erreur: Exception) -> JSONResponse:
    # La trace part au journal ; l'appelant reçoit une phrase, jamais la classe ni le texte de l'exception.
    journal.exception("Erreur imprévue du service d'optimisation", exc_info=erreur)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": {"message": "Erreur interne du service d'optimisation : le calcul n'a pas abouti."}},
    )


def _trop_gros() -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_413_CONTENT_TOO_LARGE,
        content={
            "detail": {
                "refus": "taille",
                "message": f"Corps de requête trop gros : au plus {MAX_CORPS_OCTETS // (1024 * 1024)} Mo.",
            }
        },
    )


class LimiteCorps:
    """Middleware ASGI : refuse en 413 un corps au-delà de `maximum` octets, `Content-Length` annoncé OU flux réel.

    Le corps est lu ici, en entier et borné, puis rejoué à l'application : un envoi par morceaux (sans
    `Content-Length`) est compté octet par octet, et une exception levée pendant la lecture par FastAPI deviendrait un
    400 anglais (« There was an error parsing the body ») — d'où la lecture en amont.
    """

    def __init__(self, app: ASGIApp, maximum: int = MAX_CORPS_OCTETS) -> None:
        self.app = app
        self.maximum = maximum

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        for nom, valeur in scope.get("headers", []):
            if nom == b"content-length":
                try:
                    annonce = int(valeur)
                except ValueError:
                    annonce = self.maximum + 1
                if annonce > self.maximum:
                    await _trop_gros()(scope, receive, send)
                    return
        morceaux: list[bytes] = []
        recu = 0
        while True:
            message = await receive()
            if message["type"] != "http.request":
                # Déconnexion du client : on la transmet telle quelle.
                await self.app(scope, _rejoue([message], receive), send)
                return
            corps = message.get("body", b"")
            recu += len(corps)
            if recu > self.maximum:
                await _trop_gros()(scope, receive, send)
                return
            morceaux.append(corps)
            if not message.get("more_body", False):
                break
        await self.app(
            scope, _rejoue([{"type": "http.request", "body": b"".join(morceaux), "more_body": False}], receive), send
        )


def _rejoue(messages: list[Message], suite: Receive) -> Receive:
    """Rend d'abord les messages déjà lus, puis s'en remet au `receive` d'origine (qui attend la déconnexion)."""
    file = list(messages)

    async def recevoir() -> Message:
        if file:
            return file.pop(0)
        return await suite()

    return recevoir
