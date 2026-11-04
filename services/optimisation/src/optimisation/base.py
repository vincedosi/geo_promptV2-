"""Accès à la base par psycopg 3, en direct (pas de PostgREST, donc pas de plafond de 1 000 lignes).

T1 ne porte que la sonde de `/sante`. Le pool (≤ 3 connexions, règles I/O de CLAUDE.md) viendra avec
les premiers lecteurs (T4).
"""

from dataclasses import dataclass

import psycopg

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
