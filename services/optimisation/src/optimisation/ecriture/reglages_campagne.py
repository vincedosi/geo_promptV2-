"""Les réglages de DONNÉES d'une campagne : seuils d'alerte et bascules des corrections de la phase 2 (relecture, I3).

Table : `optimisation_reglages.parametres` (sql/345), journalisée dans `optimisation_reglages_journal` sous
`nature = 'reglages'` (sql/350). C'est l'interrupteur qui manquait : `tableaux_depuis_plan` (tâche 2.1),
`univers_methode_a` (tâche 2.2) et les seuils (tâche 2.3, ± 20 % compris) étaient livrés éteints, sans écrivain.

Même patron que `algo_campagne.py` (tâche 2.7) :
  - cloisonnement APPLICATIF (rôle BYPASSRLS) : la campagne doit appartenir à `X-Espace`, sinon `CampagneHorsEspace`
    et RIEN n'est écrit ; réglage et journal lus ensuite par `campagne_id` (ils suivent la campagne, sql/348) ;
  - une transaction : ligne verrouillée `for update` (créée si absente), « avant » exact sous concurrence ;
  - rien ne change (mêmes réglages EFFECTIFS) → aucune écriture ; réglages par défaut sur une campagne sans ligne →
    aucune ligne créée ;
  - sinon `update` du réglage ET une ligne de journal (`algo_avant = algo_apres` = l'algorithme courant).

Le corps est un REMPLACEMENT de `parametres` (comme le PUT de l'algorithme) : une clé absente revient au défaut.
Stocké tel que reçu (clés données seulement), nombres écrits sans flottant ; validé avant tout accès par
`parametres_depuis_json` (Pydantic strict, bornes de sql/350) et en base par le CHECK.
"""

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any

import psycopg

from optimisation.algos.registre import ALGO_CORRECTION_DEFAUT
from optimisation.ecriture.algo_campagne import JOURNAL_MAX, _en_surcharges, _exiger, _verifier_campagne
from optimisation.lecture.reglages import ParametresOptimisation, parametres_depuis_json

Json = dict[str, Any]


def json_exact(valeur: Any) -> str:
    """Le JSON d'un objet lu sans flottant : un `Decimal` est écrit tel quel (`0.85` reste `0.85`), jamais en texte."""
    if isinstance(valeur, bool):
        return "true" if valeur else "false"
    if isinstance(valeur, Decimal):
        return format(valeur, "f")
    if isinstance(valeur, int | float):
        return json.dumps(valeur)
    if isinstance(valeur, str):
        return json.dumps(valeur, ensure_ascii=False)
    if isinstance(valeur, Mapping):
        return (
            "{" + ",".join(f"{json.dumps(str(k), ensure_ascii=False)}:{json_exact(v)}" for k, v in valeur.items()) + "}"
        )
    raise TypeError(f"valeur non sérialisable : {type(valeur).__name__}")


def lire_brut(valeur: Any) -> Json:
    """Le jsonb relu (texte ou déjà décodé) en objet aux nombres `Decimal`."""
    texte = valeur if isinstance(valeur, str) else json.dumps(valeur)
    brut = json.loads(texte, parse_float=Decimal, parse_int=Decimal)
    return brut if isinstance(brut, dict) else {}


@dataclass(frozen=True)
class EtatReglages:
    """`brut` : `parametres` tel que stocké (clés réglées seulement) ; `effectifs` : défauts compris."""

    brut: Json
    effectifs: ParametresOptimisation
    enregistre: bool
    maj_par: str | None
    maj_le: datetime | None


@dataclass(frozen=True)
class EntreeJournalReglages:
    id: str
    modifie_par: str | None
    role_auteur: str | None
    modifie_le: datetime
    avant: Json
    apres: Json


@dataclass(frozen=True)
class ReglagesEtJournal:
    etat: EtatReglages
    journal: list[EntreeJournalReglages]
    journal_tronque: bool


@dataclass(frozen=True)
class ResultatReglages:
    etat: EtatReglages
    change: bool
    entree: EntreeJournalReglages | None
    # `tableaux_depuis_plan` effectif a changé : les tableaux par CP de la campagne sont à reconstruire
    # (`refresh_campaign_rollups`, que la passerelle Next appelle — le rôle du service n'a pas ce droit).
    tableaux_a_reconstruire: bool


_DEFAUT = EtatReglages({}, ParametresOptimisation(), enregistre=False, maj_par=None, maj_le=None)

_ETAT = "select parametres::text, maj_par::text, maj_le from public.optimisation_reglages where campagne_id = %(c)s"

_JOURNAL = """
select j.id::text, j.modifie_par::text, j.role_auteur, j.modifie_le, j.reglages_avant::text, j.reglages_apres::text
  from public.optimisation_reglages_journal j
 where j.campagne_id = %(c)s and j.nature = 'reglages'
 order by j.modifie_le desc, j.id desc
 limit %(limite)s
"""


def _etat(brut_texte: Any, maj_par: Any, maj_le: Any) -> EtatReglages:
    brut = lire_brut(brut_texte)
    return EtatReglages(brut, parametres_depuis_json(json_exact(brut)), True, maj_par, maj_le)


def _entree(ligne: tuple[Any, ...]) -> EntreeJournalReglages:
    return EntreeJournalReglages(
        id=str(ligne[0]),
        modifie_par=ligne[1],
        role_auteur=ligne[2],
        modifie_le=ligne[3],
        avant=lire_brut(ligne[4]),
        apres=lire_brut(ligne[5]),
    )


def lire_reglages_campagne(
    connexion: psycopg.Connection[Any], campagne: str, espace: str, limite: int = JOURNAL_MAX
) -> ReglagesEtJournal:
    """Les réglages de données courants et les `limite` derniers changements (du plus récent au plus ancien)."""
    with connexion.cursor() as cur:
        _verifier_campagne(cur, campagne, espace)
        cur.execute(_ETAT, {"c": campagne})
        ligne = cur.fetchone()
        etat = _DEFAUT if ligne is None else _etat(*ligne)
        cur.execute(_JOURNAL, {"c": campagne, "limite": limite + 1})
        lignes = cur.fetchall()
    return ReglagesEtJournal(etat, [_entree(x) for x in lignes[:limite]], journal_tronque=len(lignes) > limite)


def ecrire_reglages_campagne(
    connexion: psycopg.Connection[Any],
    *,
    campagne: str,
    espace: str,
    utilisateur: str | None,
    role: str | None,
    brut: Json,
    version_algo: Callable[[str], int],
) -> ResultatReglages:
    """Remplace `parametres` (DÉJÀ validé : `parametres_depuis_json(json_exact(brut))`) et journalise, dans la
    transaction de `connexion`. `version_algo` donne la version au catalogue de l'algorithme courant (journal)."""
    apres = parametres_depuis_json(json_exact(brut))
    with connexion.cursor() as cur:
        _verifier_campagne(cur, campagne, espace)
        cur.execute(
            "select parametres::text, maj_par::text, maj_le, algo_id, algo_parametres "
            "from public.optimisation_reglages where campagne_id = %(c)s for update",
            {"c": campagne},
        )
        ligne = cur.fetchone()
        if ligne is None:
            if apres == ParametresOptimisation():
                return ResultatReglages(_DEFAUT, change=False, entree=None, tableaux_a_reconstruire=False)
            cur.execute(
                "insert into public.optimisation_reglages (campagne_id, workspace_id) values (%(c)s, %(e)s) "
                "on conflict (campagne_id) do nothing",
                {"c": campagne, "e": espace},
            )
            cur.execute(
                "select parametres::text, maj_par::text, maj_le, algo_id, algo_parametres "
                "from public.optimisation_reglages where campagne_id = %(c)s for update",
                {"c": campagne},
            )
            ligne = _exiger(cur.fetchone())
        avant = _etat(ligne[0], ligne[1], ligne[2])
        if avant.effectifs == apres:
            return ResultatReglages(avant, change=False, entree=None, tableaux_a_reconstruire=False)
        algo = str(ligne[3]) if ligne[3] is not None else ALGO_CORRECTION_DEFAUT
        surcharges = json.dumps(_en_surcharges(ligne[4]))
        texte_apres = json_exact(brut)
        cur.execute(
            "update public.optimisation_reglages set parametres = %(p)s::jsonb, workspace_id = %(e)s, "
            "maj_par = %(qui)s, maj_le = now() where campagne_id = %(c)s returning maj_par::text, maj_le",
            {"p": texte_apres, "e": espace, "qui": utilisateur, "c": campagne},
        )
        maj = _exiger(cur.fetchone())
        cur.execute(
            "insert into public.optimisation_reglages_journal (workspace_id, campagne_id, modifie_par, role_auteur, "
            "nature, algo_avant, parametres_avant, algo_apres, algo_version_apres, parametres_apres, "
            "reglages_avant, reglages_apres) "
            "values (%(e)s, %(c)s, %(qui)s, %(role)s, 'reglages', %(algo)s, %(s)s::jsonb, %(algo)s, %(v)s, "
            "%(s)s::jsonb, %(avant)s::jsonb, %(apres)s::jsonb) "
            "returning id::text, modifie_par::text, role_auteur, modifie_le, "
            "reglages_avant::text, reglages_apres::text",
            {
                "e": espace,
                "c": campagne,
                "qui": utilisateur,
                "role": role,
                "algo": algo,
                "s": surcharges,
                "v": version_algo(algo),
                "avant": json_exact(avant.brut),
                "apres": texte_apres,
            },
        )
        cree = _exiger(cur.fetchone())
    etat = EtatReglages(lire_brut(texte_apres), apres, enregistre=True, maj_par=maj[0], maj_le=maj[1])
    return ResultatReglages(
        etat,
        change=True,
        entree=_entree(cree),
        tableaux_a_reconstruire=avant.effectifs.tableaux_depuis_plan != apres.tableaux_depuis_plan,
    )
