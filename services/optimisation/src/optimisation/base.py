"""Accès à la base par psycopg 3, en direct (pas de PostgREST, donc pas de plafond de 1 000 lignes).

`/sante` ouvre sa propre connexion (une sonde ne doit pas dépendre du pool qu'elle diagnostique). Les lecteurs (T4)
empruntent au pool : 3 connexions au plus (règles I/O de CLAUDE.md), ouvert au premier emprunt, pas à l'import.
"""

import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

import psycopg
from psycopg_pool import ConnectionPool

DELAI_CONNEXION_S = 5
DELAI_REQUETE_MS = 5_000


@dataclass(frozen=True)
class EtatBase:
    """Résultat de la sonde : jamais l'URL ni le mot de passe, seulement ce qui aide au diagnostic."""

    ok: bool
    role: str | None = None
    erreur: str | None = None


def sonder_base(url: str | None) -> EtatBase:
    """Ouvre une connexion, lit `current_user`, la referme. Ne lève jamais."""
    if url is None:
        return EtatBase(ok=False, erreur="OPTIMISATION_DATABASE_URL absente")
    try:
        with (
            psycopg.connect(
                url,
                connect_timeout=DELAI_CONNEXION_S,
                options=f"-c statement_timeout={DELAI_REQUETE_MS}",
                application_name="optimisation_sante",
            ) as connexion,
            connexion.cursor() as curseur,
        ):
            curseur.execute("select current_user")
            ligne = curseur.fetchone()
    except psycopg.Error as erreur:
        # On ne garde que la classe et la première ligne du message : rien d'autre ne sort.
        texte = str(erreur).strip()
        premiere = texte.splitlines()[0] if texte else ""
        return EtatBase(ok=False, erreur=f"{type(erreur).__name__}: {premiere}")
    return EtatBase(ok=True, role=str(ligne[0]) if ligne else None)


TAILLE_MAX_POOL = 3
DELAI_EMPRUNT_S = 10.0

_pool: ConnectionPool[psycopg.Connection[Any]] | None = None
_verrou = threading.Lock()


class BaseIndisponible(Exception):
    """URL absente, base injoignable ou pool épuisé : le service répond 503, jamais un calcul sans données."""


def _obtenir_pool(url: str | None) -> ConnectionPool[psycopg.Connection[Any]]:
    global _pool
    with _verrou:
        if _pool is None:
            if url is None:
                raise BaseIndisponible("OPTIMISATION_DATABASE_URL absente")
            _pool = ConnectionPool(
                url,
                min_size=1,
                max_size=TAILLE_MAX_POOL,
                open=False,
                kwargs={"connect_timeout": DELAI_CONNEXION_S, "application_name": "optimisation"},
            )
            _pool.open(wait=False)
        return _pool


@contextmanager
def connexion(url: str | None) -> Iterator[psycopg.Connection[Any]]:
    """Une connexion empruntée au pool, en lecture seule ; `BaseIndisponible` si elle ne peut pas être obtenue."""
    try:
        with _obtenir_pool(url).connection(timeout=DELAI_EMPRUNT_S) as conn:
            conn.read_only = True
            yield conn
    except psycopg.Error as erreur:
        texte = str(erreur).strip()
        # PoolTimeout (pool épuisé) est une psycopg.Error. Classe et première ligne seulement : jamais l'URL.
        raise BaseIndisponible(f"{type(erreur).__name__}: {texte.splitlines()[0] if texte else ''}") from erreur


@contextmanager
def connexion_ecriture(url: str | None) -> Iterator[psycopg.Connection[Any]]:
    """Une connexion du pool OUVERTE EN ÉCRITURE (tâche 2.7, seule écriture à ce jour : `optimisation_reglages*`).

    Le pool valide la transaction à la sortie normale du `with`, l'annule sur exception. `read_only` est reposé à
    chaque emprunt par `connexion` : une connexion rendue ici ne reste pas en écriture pour un lecteur suivant."""
    try:
        with _obtenir_pool(url).connection(timeout=DELAI_EMPRUNT_S) as conn:
            conn.read_only = False
            yield conn
    except psycopg.Error as erreur:
        texte = str(erreur).strip()
        raise BaseIndisponible(f"{type(erreur).__name__}: {texte.splitlines()[0] if texte else ''}") from erreur


def fermer_pool() -> None:
    global _pool
    with _verrou:
        if _pool is not None:
            _pool.close()
            _pool = None
