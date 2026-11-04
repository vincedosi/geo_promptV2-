"""Vérificateur SCRAM-SHA-256 calculé CÔTÉ CLIENT, pour `ALTER ROLE … PASSWORD '<vérificateur>'`.

Pourquoi (relecture A, I1) : la base locale journalise le DDL (`log_statement = ddl`) et `pg_stat_statements` garde le
texte des `ALTER ROLE`. Un mot de passe passé en clair y restait lisible — celui d'un rôle BYPASSRLS. Postgres accepte
un vérificateur SCRAM déjà calculé à la place du mot de passe et le stocke tel quel : seul le haché atteint alors les
journaux.

Format (identique à `pg_authid.rolpassword`) : `SCRAM-SHA-256$<itérations>:<sel b64>$<StoredKey b64>:<ServerKey b64>`
(RFC 5802 / RFC 7677). Le mot de passe est refusé s'il n'est pas en ASCII imprimable sans espace : Postgres applique
SASLprep, que ce module ne réimplémente pas ; sur ce jeu de caractères SASLprep est l'identité.

Usage (scripts/local/13-optimisation-up.sh) : le mot de passe arrive sur l'ENTRÉE STANDARD (jamais en argument, visible
dans `ps`), le vérificateur sort sur la sortie standard.

    printf '%s' "$MDP" | uv run python -m optimisation.outils.scram
"""

import base64
import hashlib
import hmac
import os
import sys

ITERATIONS = 4096  # la valeur par défaut de Postgres (scram_iterations)
LONGUEUR_SEL = 16


def _b64(octets: bytes) -> str:
    return base64.b64encode(octets).decode("ascii")


def cles(mot_de_passe: str, sel: bytes, iterations: int = ITERATIONS) -> tuple[bytes, bytes, bytes]:
    """(ClientKey, StoredKey, ServerKey) de la RFC 5802."""
    if not mot_de_passe or not all(33 <= ord(c) <= 126 for c in mot_de_passe):
        raise ValueError("mot de passe vide ou hors ASCII imprimable sans espace (SASLprep non réimplémenté)")
    sale = hashlib.pbkdf2_hmac("sha256", mot_de_passe.encode("ascii"), sel, iterations)
    client = hmac.new(sale, b"Client Key", hashlib.sha256).digest()
    stockee = hashlib.sha256(client).digest()
    serveur = hmac.new(sale, b"Server Key", hashlib.sha256).digest()
    return client, stockee, serveur


def verificateur(mot_de_passe: str, sel: bytes | None = None, iterations: int = ITERATIONS) -> str:
    """Le vérificateur à passer à `ALTER ROLE … PASSWORD`. Sel aléatoire si absent."""
    sel = os.urandom(LONGUEUR_SEL) if sel is None else sel
    _, stockee, serveur = cles(mot_de_passe, sel, iterations)
    return f"SCRAM-SHA-256${iterations}:{_b64(sel)}${_b64(stockee)}:{_b64(serveur)}"


def main() -> int:
    mot_de_passe = sys.stdin.read().strip()
    try:
        print(verificateur(mot_de_passe))
    except ValueError as erreur:
        print(f"scram : {erreur}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
