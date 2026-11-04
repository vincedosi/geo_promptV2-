"""Configuration lue dans l'environnement (fichier services/optimisation/.env, non suivi par git).

Noms et rôles : ARCHITECTURE.md § « Variables d'environnement » > « Service d'optimisation ».
Lues à chaque appel et non figées à l'import : les tests les posent avec `monkeypatch.setenv`.
"""

import os


def cle_interne() -> str | None:
    """Clé de la passerelle Next → Python (`OPTIMISATION_CLE_INTERNE`), None si absente ou vide."""
    valeur = os.environ.get("OPTIMISATION_CLE_INTERNE", "").strip()
    return valeur or None


def url_base() -> str | None:
    """URL Postgres du rôle optimisation_service (`OPTIMISATION_DATABASE_URL`), None si absente ou vide."""
    valeur = os.environ.get("OPTIMISATION_DATABASE_URL", "").strip()
    return valeur or None
