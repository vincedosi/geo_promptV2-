"""L'algorithme de correction d'une campagne : réglage courant, journal, écriture tracée (tâche 2.7).

Tables : `optimisation_reglages.algo_id` / `algo_parametres` et `optimisation_reglages_journal` (sql/345, sql/347).

CLOISONNEMENT (plan § 5 et § 9.3) : `optimisation_service` est BYPASSRLS, la barrière est ICI. Chaque requête exige
que la campagne appartienne à l'espace reçu (`X-Espace` = `dsp_campaigns.organization_id`) ; le réglage et le journal
ne sont lus que sous le même `workspace_id`. Une campagne d'un autre espace → `CampagneHorsEspace`, et RIEN n'est
écrit (le contrôle précède toute écriture, dans la même transaction).

ÉCRITURE (une transaction, celle de la connexion de l'appelant) :
  1. la campagne dans l'espace, sinon refus ;
  2. `select … for update` de la ligne de réglages ; absente, elle est créée (`insert … on conflict do nothing`) puis
     verrouillée : deux changements simultanés se sérialisent sur cette ligne, et chacun journalise le vrai « avant » ;
  3. rien ne change (même algorithme, mêmes surcharges) → aucune écriture, aucune ligne de journal ni de réglage ;
  4. sinon `update` du réglage ET `insert` d'une ligne de journal — ensemble ou pas du tout.

Effet au cycle suivant : rien n'est recalculé ici (plan § 16.2). Le changement en cours de campagne est AUTORISÉ
(décision du propriétaire du 05/11).

EXPLAIN ANALYZE (local, 05/11) : chaque requête passe par une clé primaire ou par l'index
`optimisation_reglages_journal_campagne` (journal borné par `limit`) — mesures dans le rapport de la tâche 2.7.
"""

import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import psycopg

from optimisation.algos.registre import ALGO_CORRECTION_DEFAUT
from optimisation.lecture.reglages import CampagneHorsEspace

# Le journal rendu est borné : un écran n'en montre pas davantage, et la lecture reste un parcours d'index court.
JOURNAL_MAX = 50


@dataclass(frozen=True)
class EntreeJournal:
    id: str
    modifie_par: str | None
    role_auteur: str | None
    modifie_le: datetime
    algo_avant: str
    parametres_avant: dict[str, float]
    algo_apres: str
    algo_version_apres: int
    parametres_apres: dict[str, float]


@dataclass(frozen=True)
class EtatAlgo:
    """Le réglage courant. `enregistre` : une ligne existe (sinon défaut du catalogue, aucune surcharge)."""

    algo_id: str
    surcharges: dict[str, float]
    enregistre: bool
    maj_par: str | None
    maj_le: datetime | None


@dataclass(frozen=True)
class EtatEtJournal:
    etat: EtatAlgo
    journal: list[EntreeJournal]
    journal_tronque: bool


@dataclass(frozen=True)
class ResultatEcriture:
    etat: EtatAlgo
    change: bool
    entree: EntreeJournal | None


def _en_surcharges(valeur: Any) -> dict[str, float]:
    """Le jsonb relu (dict de nombres, garanti par le CHECK) en `dict[str, float]`, ordre des clés conservé."""
    if isinstance(valeur, str):
        valeur = json.loads(valeur)
    if not isinstance(valeur, dict):
        return {}
    return {str(k): float(v) for k, v in valeur.items()}


def _verifier_campagne(cur: psycopg.Cursor[Any], campagne: str, espace: str) -> None:
    cur.execute(
        "select 1 from public.dsp_campaigns where id = %(campagne)s and organization_id = %(espace)s",
        {"campagne": campagne, "espace": espace},
    )
    if cur.fetchone() is None:
        raise CampagneHorsEspace(campagne)


_ETAT = """
select algo_id, algo_parametres, maj_par::text, maj_le
  from public.optimisation_reglages
 where campagne_id = %(campagne)s and workspace_id = %(espace)s
"""

_JOURNAL = """
select j.id::text, j.modifie_par::text, j.role_auteur, j.modifie_le, j.algo_avant, j.parametres_avant, j.algo_apres,
       j.algo_version_apres, j.parametres_apres
  from public.optimisation_reglages_journal j
 where j.campagne_id = %(campagne)s and j.workspace_id = %(espace)s
 -- Colonnes QUALIFIÉES : `id` seul désignerait la colonne de sortie `id::text` (tri texte, index inutilisable).
 order by j.modifie_le desc, j.id desc
 limit %(limite)s
"""


def _entree(ligne: tuple[Any, ...]) -> EntreeJournal:
    return EntreeJournal(
        id=str(ligne[0]),
        modifie_par=ligne[1],
        role_auteur=ligne[2],
        modifie_le=ligne[3],
        algo_avant=str(ligne[4]),
        parametres_avant=_en_surcharges(ligne[5]),
        algo_apres=str(ligne[6]),
        algo_version_apres=int(ligne[7]),
        parametres_apres=_en_surcharges(ligne[8]),
    )


def _etat(cur: psycopg.Cursor[Any], campagne: str, espace: str) -> EtatAlgo:
    cur.execute(_ETAT, {"campagne": campagne, "espace": espace})
    ligne = cur.fetchone()
    if ligne is None:
        return EtatAlgo(ALGO_CORRECTION_DEFAUT, {}, enregistre=False, maj_par=None, maj_le=None)
    return EtatAlgo(str(ligne[0]), _en_surcharges(ligne[1]), enregistre=True, maj_par=ligne[2], maj_le=ligne[3])


def _exiger(ligne: tuple[Any, ...] | None) -> tuple[Any, ...]:
    """Une ligne que la requête rend forcément (`returning`, ligne verrouillée après insertion)."""
    if ligne is None:
        raise RuntimeError("écriture du réglage d'algorithme : ligne attendue absente")
    return ligne


def _verrouiller(cur: psycopg.Cursor[Any], campagne: str) -> tuple[Any, ...] | None:
    cur.execute(
        "select algo_id, algo_parametres, workspace_id::text, maj_par::text, maj_le "
        "from public.optimisation_reglages where campagne_id = %(campagne)s for update",
        {"campagne": campagne},
    )
    return cur.fetchone()


def lire_algo_campagne(
    connexion: psycopg.Connection[Any], campagne: str, espace: str, limite: int = JOURNAL_MAX
) -> EtatEtJournal:
    """Le réglage courant et les `limite` derniers changements (du plus récent au plus ancien)."""
    with connexion.cursor() as cur:
        _verifier_campagne(cur, campagne, espace)
        etat = _etat(cur, campagne, espace)
        # `limite + 1` : on sait si le journal a été coupé, sans compter toute la table.
        cur.execute(_JOURNAL, {"campagne": campagne, "espace": espace, "limite": limite + 1})
        lignes = cur.fetchall()
    return EtatEtJournal(etat, [_entree(x) for x in lignes[:limite]], journal_tronque=len(lignes) > limite)


def ecrire_algo_campagne(
    connexion: psycopg.Connection[Any],
    *,
    campagne: str,
    espace: str,
    utilisateur: str | None,
    role: str | None,
    algo_id: str,
    algo_version: int,
    surcharges: Mapping[str, float],
) -> ResultatEcriture:
    """Pose l'algorithme et ses surcharges (DÉJÀ validés par le catalogue) et journalise, dans la transaction de
    `connexion` — l'appelant valide (le pool le fait à la sortie du `with`) ou annule."""
    apres = {k: float(v) for k, v in surcharges.items()}
    with connexion.cursor() as cur:
        _verifier_campagne(cur, campagne, espace)
        ligne = _verrouiller(cur, campagne)
        if ligne is None:
            if algo_id == ALGO_CORRECTION_DEFAUT and not apres:
                # Choisir le défaut sans surcharge sur une campagne sans réglage : rien ne change, aucune ligne créée.
                return ResultatEcriture(
                    EtatAlgo(ALGO_CORRECTION_DEFAUT, {}, enregistre=False, maj_par=None, maj_le=None), False, None
                )
            # Deux premiers réglages simultanés : l'un insère, l'autre ne fait rien, puis tous deux attendent le verrou.
            cur.execute(
                "insert into public.optimisation_reglages (campagne_id, workspace_id) "
                "values (%(campagne)s, %(espace)s) on conflict (campagne_id) do nothing",
                {"campagne": campagne, "espace": espace},
            )
            ligne = _exiger(_verrouiller(cur, campagne))  # insérée ou existante, verrouillée
        # Une ligne posée sous un AUTRE espace (campagne changée d'espace depuis) ne vaut pas pour celui-ci : comme à la
        # lecture (`lire_reglages`), son « avant » est le défaut, et l'écriture la rattache à l'espace propriétaire.
        meme_espace = ligne[2] == espace
        algo_avant = str(ligne[0]) if meme_espace else ALGO_CORRECTION_DEFAUT
        avant = _en_surcharges(ligne[1]) if meme_espace else {}
        if meme_espace and algo_avant == algo_id and avant == apres:
            etat = EtatAlgo(algo_avant, avant, enregistre=True, maj_par=ligne[3], maj_le=ligne[4])
            return ResultatEcriture(etat, change=False, entree=None)
        cur.execute(
            "update public.optimisation_reglages set algo_id = %(algo)s, algo_parametres = %(params)s::jsonb, "
            "workspace_id = %(espace)s, maj_par = %(qui)s, maj_le = now() "
            "where campagne_id = %(campagne)s returning maj_par::text, maj_le",
            {"algo": algo_id, "params": json.dumps(apres), "espace": espace, "qui": utilisateur, "campagne": campagne},
        )
        maj = _exiger(cur.fetchone())
        cur.execute(
            "insert into public.optimisation_reglages_journal (workspace_id, campagne_id, modifie_par, role_auteur, "
            "algo_avant, parametres_avant, algo_apres, algo_version_apres, parametres_apres) "
            "values (%(espace)s, %(campagne)s, %(qui)s, %(role)s, %(avant)s, %(p_avant)s::jsonb, %(apres)s, "
            "%(version)s, %(p_apres)s::jsonb) "
            "returning id::text, modifie_par::text, role_auteur, modifie_le, algo_avant, parametres_avant, "
            "algo_apres, algo_version_apres, parametres_apres",
            {
                "espace": espace,
                "campagne": campagne,
                "qui": utilisateur,
                "role": role,
                "avant": algo_avant,
                "p_avant": json.dumps(avant),
                "apres": algo_id,
                "version": algo_version,
                "p_apres": json.dumps(apres),
            },
        )
        cree = _exiger(cur.fetchone())
    etat = EtatAlgo(algo_id, apres, enregistre=True, maj_par=maj[0], maj_le=maj[1])
    return ResultatEcriture(etat, change=True, entree=_entree(cree))
