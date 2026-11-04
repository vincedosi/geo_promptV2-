"""Les volumes attendus (A8, E5, D35) : `volumes_attendus_cp_univers` (sql/337) — le pendant de
`lireVolumesAttendus` (`lib/zones/part-prevue-serveur.ts`).

EXPLAIN ANALYZE (local, 04/11, rapport du groupe B) : la fonction parcourt `cp_population_totale_e7` en entier
(6 010 lignes, 1 093 tampons partagés, tous en cache) — c'est voulu, le total de l'univers est une somme sur tout le
référentiel. 6 à 12 ms pour une zone locale ; 0,47 s pour les 6 010 codes d'une zone nationale (le filtre
`code_postal = any(tableau)` est linéaire dans la taille du tableau, par ligne). Fonction existante, SECURITY DEFINER,
non modifiée ici.
"""

from typing import Any

import psycopg

from optimisation.noyau.types import Univers, VolumesAttendus


class VolumesIllisibles(Exception):
    """Lecture des volumes en échec ou réponse hors forme."""


def lire_volumes(connexion: psycopg.Connection[Any], codes: list[str], univers: Univers) -> VolumesAttendus:
    """Le volume de chaque code demandé (dédoublonné, ordre de première apparition) et le total de l'univers."""
    uniques = list(dict.fromkeys(codes))
    with connexion.cursor() as curseur:
        curseur.execute("select public.volumes_attendus_cp_univers(%s::text[], %s)", (uniques, univers))
        ligne = curseur.fetchone()
    if ligne is None or not isinstance(ligne[0], dict):
        raise VolumesIllisibles("volumes_attendus_cp_univers : réponse vide ou hors forme")
    lu: dict[str, Any] = ligne[0]
    if lu.get("univers") not in ("METRO", "FR") or not isinstance(lu.get("codes"), dict):
        raise VolumesIllisibles("volumes_attendus_cp_univers : univers ou codes hors forme")
    total = float(lu["total"])
    if total < 0:
        raise VolumesIllisibles("volumes_attendus_cp_univers : total négatif")
    univers_lu: Univers = "METRO" if lu["univers"] == "METRO" else "FR"
    return VolumesAttendus(
        par_code={str(k): float(v) for k, v in lu["codes"].items()},
        total=total,
        univers=univers_lu,
    )
