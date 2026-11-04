"""Les entrées du plan MÉTHODE A (phase 1.1) : stratégie, univers figé, codes de la zone, valeurs de l'indicateur.

Pendant SQL : ce que lit `apply_zone_weights_to_strategy` (sql/106). Deux écarts VOULUS, dits ici :

- l'univers n'est PAS lu dans `dsp_campaign_data` (le SQL : `SELECT DISTINCT postal_code` sur toutes les campagnes,
  394 Mo parcourus, 2,5 s en local — et un univers qui bouge : 11 415 codes aujourd'hui contre 11 435 quand la démo a
  été écrite). Deux sources, choisies par le réglage `univers_methode_a` (`optimisation_reglages`, tâche 2.2) :
  `fige` (DÉFAUT, comportement de la phase 1) = les codes du plan écrit de la stratégie (`bidding_zone_configs`) ;
  `referentiel` = `ref_codes_postaux` complet (6 187 codes) — la correction du cahier : les codes jamais livrés
  nulle part y entrent (+20 pour la démo), les codes étrangers livrés (`00-001`, `?`… : 5 248, tous à 0) en sortent.
  La fonction SQL reste en place et inchangée jusqu'à la bascule ;
- les `numeric` et les JSON sont lus en TEXTE et relus en `Decimal` : pas de flottant entre la base et le noyau, puisque
  le calcul porté est en `numeric`.

`custom_geo_zone_codes` et `indicator_cp_values` ne sont lisibles par `optimisation_service` qu'avec sql/343.
Toutes les lectures sont en ordre TOTAL, indépendant de la collation de la base (`collate "C"`, plan § 11).
"""

import json
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

import psycopg

from optimisation.lecture.reglages import UniversMethodeA


class StrategieIntrouvable(Exception):
    """La campagne n'a pas de stratégie."""


@dataclass(frozen=True)
class StrategieMethodeA:
    id: str
    zone_id: str | None
    poids_en_zone: dict[str, Any]
    poids_hors_zone: dict[str, Any]


def _json_decimal(texte: str) -> Any:
    return json.loads(texte, parse_float=Decimal, parse_int=Decimal)


def lire_strategie(connexion: psycopg.Connection[Any], campagne: str) -> StrategieMethodeA:
    """La stratégie la plus récente de la campagne, comme `refresh_campaign_rollups` et `get_campaign_suivi`.

    Départage (relecture de phase 1, M1) : le SQL trie par `created_at DESC LIMIT 1` SANS second critère ; ici `, id`
    s'ajoute. Pour deux stratégies créées au même instant, le Python est déterministe et le SQL ne l'est pas : ils
    peuvent alors retenir deux stratégies différentes. Aucune campagne de la base n'est dans ce cas (05/11).
    """
    with connexion.cursor() as cur:
        cur.execute(
            "select id::text, zone_id::text, in_zone_weights::text, out_zone_weights::text "
            "from public.bidding_strategies where campaign_id = %s order by created_at desc, id limit 1",
            (campagne,),
        )
        ligne = cur.fetchone()
    if ligne is None:
        raise StrategieIntrouvable(campagne)
    return StrategieMethodeA(
        id=str(ligne[0]),
        zone_id=None if ligne[1] is None else str(ligne[1]),
        poids_en_zone=_json_decimal(str(ligne[2])),
        poids_hors_zone=_json_decimal(str(ligne[3])),
    )


def lire_univers_fige(connexion: psycopg.Connection[Any], strategie: str) -> list[str]:
    """Les codes distincts du plan écrit de la stratégie, triés."""
    with connexion.cursor() as cur:
        cur.execute(
            "select postal_code from public.bidding_zone_configs where strategy_id = %s "
            'group by postal_code order by postal_code collate "C"',
            (strategie,),
        )
        return [str(r[0]) for r in cur.fetchall()]


def lire_univers_referentiel(connexion: psycopg.Connection[Any]) -> list[str]:
    """Tous les codes de `ref_codes_postaux` (clé primaire), triés.

    EXPLAIN ANALYZE (local, 05/11) : parcours d'index seul sur la clé primaire, 6 187 lignes, 19 tampons (en cache),
    0 lecture de la table, 3 ms.
    """
    with connexion.cursor() as cur:
        cur.execute('select code_postal from public.ref_codes_postaux order by code_postal collate "C"')
        return [str(r[0]) for r in cur.fetchall()]


def lire_univers(connexion: psycopg.Connection[Any], strategie: str, source: UniversMethodeA) -> list[str]:
    """L'univers du plan méthode A selon le réglage `univers_methode_a` (`fige` par défaut)."""
    if source == "referentiel":
        return lire_univers_referentiel(connexion)
    return lire_univers_fige(connexion, strategie)


def lire_codes_zone(connexion: psycopg.Connection[Any], zone: str) -> list[str]:
    """Les codes `cp` de la zone (`custom_geo_zone_codes`), distincts, triés."""
    with connexion.cursor() as cur:
        cur.execute(
            "select code from public.custom_geo_zone_codes where zone_id = %s and code_type = 'cp' "
            'group by code order by code collate "C"',
            (zone,),
        )
        return [str(r[0]) for r in cur.fetchall()]


def lire_valeurs_indicateur(connexion: psycopg.Connection[Any], variable: str, codes: list[str]) -> dict[str, Decimal]:
    """`indicator_cp_values.value` de la variable pour les codes demandés (clé primaire : un code, une valeur)."""
    with connexion.cursor() as cur:
        cur.execute(
            "select postal_code, value::text from public.indicator_cp_values "
            'where indicator_code = %s and postal_code = any(%s::text[]) order by postal_code collate "C"',
            (variable, codes),
        )
        return {str(cp): Decimal(str(v)) for cp, v in cur.fetchall()}


def lire_multiplicateurs(connexion: psycopg.Connection[Any], strategie: str) -> dict[str, Decimal]:
    """Les `bid_multiplier` écrits (pays FR), pour comparer un recalcul à ce que la fonction SQL a produit."""
    with connexion.cursor() as cur:
        cur.execute(
            "select postal_code, bid_multiplier::text from public.bidding_zone_configs "
            "where strategy_id = %s and country_code = 'FR' order by postal_code collate \"C\"",
            (strategie,),
        )
        return {str(cp): Decimal(str(m)) for cp, m in cur.fetchall()}
