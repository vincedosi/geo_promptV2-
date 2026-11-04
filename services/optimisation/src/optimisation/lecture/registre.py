"""Le registre des mécanismes de poids (`plateformes_poids`, sql/305) — le pendant de `lirePoids`
(`lib/zones/conversion-serveur.ts`), mêmes colonnes, même ordre, même borne.

EXPLAIN ANALYZE (local, 04/11, rapport du groupe B) : parcours d'index sur la clé primaire
`(plateforme, maille, mecanisme)`, 2 tampons, 0,9 ms. Table de 5 lignes, bornée par construction (4 plateformes × 7
mailles × 4 mécanismes) ; on lit `MAX_PLATEFORMES_POIDS + 1` lignes pour échouer plutôt que tronquer.
"""

from decimal import Decimal
from typing import Any

import psycopg

from optimisation.noyau.types import PlateformePoids, RegleGroupe

MAX_PLATEFORMES_POIDS = 150

_REQUETE = """
select plateforme, maille, mecanisme, valeur_min, valeur_max, nb_max_entrees, poids_groupe_cp, branche,
       parametres_a_verifier
  from public.plateformes_poids
 where plateforme = any(%(plateformes)s) and maille = %(maille)s
 order by plateforme, maille, mecanisme
 limit %(limite)s
"""


class RegistreIllisible(Exception):
    """Lecture du registre en échec ou au-delà de sa borne."""


def _nombre(v: Decimal | int | float | None) -> float | None:
    # `numeric` → Decimal → double : le même nombre que le `Number("0.1")` du TS sur le texte JSON de PostgREST.
    return None if v is None else float(v)


def _regle(v: object) -> RegleGroupe | None:
    if v is None:
        return None
    if v == "meme" or v == "divise":
        return v
    raise RegistreIllisible(f"plateformes_poids.poids_groupe_cp inconnu : {v!r}")


def _limite(v: object) -> int | None:
    # `CHECK nb_max_entrees > 0` (sql/305) l'interdit en base ; s'il passait quand même, `ceil(n ÷ 0)` lèverait au
    # milieu du calcul (500). Registre incohérent = registre illisible : 503 nommé, avant tout calcul (relecture B).
    if v is None:
        return None
    limite = int(str(v))
    if limite <= 0:
        raise RegistreIllisible(f"plateformes_poids.nb_max_entrees doit être > 0 : {limite}")
    return limite


def lire_poids(connexion: psycopg.Connection[Any], plateformes: list[str], maille: str = "cp") -> list[PlateformePoids]:
    """Les mécanismes des plateformes demandées à la maille donnée, triés comme le TS."""
    with connexion.cursor() as curseur:
        curseur.execute(
            _REQUETE,
            {"plateformes": sorted(set(plateformes)), "maille": maille, "limite": MAX_PLATEFORMES_POIDS + 1},
        )
        lignes = curseur.fetchall()
    if len(lignes) > MAX_PLATEFORMES_POIDS:
        raise RegistreIllisible("plateformes_poids : borne de lecture dépassée")
    sortie: list[PlateformePoids] = []
    for plateforme, maille_lue, mecanisme, vmin, vmax, nb_max, groupe, branche, a_verifier in lignes:
        sortie.append(
            PlateformePoids(
                plateforme=str(plateforme),
                maille=str(maille_lue),
                mecanisme=str(mecanisme),
                valeur_min=_nombre(vmin),
                valeur_max=_nombre(vmax),
                nb_max_entrees=_limite(nb_max),
                poids_groupe_cp=_regle(groupe),
                branche=bool(branche),
                parametres_a_verifier=tuple(str(p) for p in a_verifier),
            )
        )
    return sortie
