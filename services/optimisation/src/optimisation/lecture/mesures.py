"""Les entrées des MESURES (phases 1.2-1.3) : paramètres de campagne, stratégie, rollups par code et par jour, plan
actif, référentiel géographique — ce que lisent `calculer_alignement_geo`, `alignement_par_maille`,
`get_campaign_expected` et `get_campaign_suivi`.

Les `numeric` sont lus en TEXTE et relus en `Decimal` (échelle conservée : elle se voit dans les sorties) ; les dates
deviennent des numéros de jour (`toordinal`), le noyau n'ayant pas de `datetime`. Ordre TOTAL, indépendant de la
collation (`collate "C"`). `ref_departements` et `ref_regions` exigent sql/343.

EXPLAIN ANALYZE (local, 04/11, démo « élections ») : `campaign_cp_rollup` en parcours séquentiel (table entière :
344 tampons, tous en cache, 7 ms, 10 205 lignes rendues) — le planificateur préfère le parcours à la clé primaire tant
que la table est petite ; `campaign_daily_rollup` 4 tampons, 150 lignes. À revérifier quand la table grossira.
"""

import json
from datetime import date
from decimal import Decimal
from typing import Any

import psycopg

from optimisation.noyau.mesures import LigneCp, LigneJour, ParametresCampagne, Referentiel, StrategieSuivi
from optimisation.noyau.prevu import LignePlan, StrategiePrevue


def _dec(v: Any) -> Decimal | None:
    return None if v is None else Decimal(str(v))


def _jour(v: Any) -> int | None:
    return v.toordinal() if isinstance(v, date) else None


def lire_parametres_campagne(connexion: psycopg.Connection[Any], campagne: str) -> ParametresCampagne | None:
    """`dsp_campaigns.tolerance_pct` et `overpressure_weight` ; None si la campagne n'existe pas."""
    with connexion.cursor() as cur:
        cur.execute(
            "select tolerance_pct::text, overpressure_weight::text from public.dsp_campaigns where id = %s",
            (campagne,),
        )
        ligne = cur.fetchone()
    if ligne is None:
        return None
    return ParametresCampagne(Decimal(str(ligne[0])), Decimal(str(ligne[1])))


def lire_strategie_suivi(connexion: psycopg.Connection[Any], campagne: str) -> tuple[str, StrategieSuivi] | None:
    """La stratégie la plus récente (`ORDER BY created_at DESC LIMIT 1`) : son id et ce qu'en lisent les mesures.

    Départage (relecture de phase 1, M1) : le SQL trie par `created_at DESC LIMIT 1` SANS second critère ; ici `, id`
    s'ajoute. Pour deux stratégies créées au même instant, le Python est déterministe et le SQL ne l'est pas : ils
    peuvent alors retenir deux stratégies différentes. Aucune campagne de la base n'est dans ce cas (05/11).
    """
    with connexion.cursor() as cur:
        cur.execute(
            "select id::text, total_budget::text, forecast_cpm::text, start_date, end_date, kpi_target::text, "
            "objective_code, out_zone_weights::text from public.bidding_strategies where campaign_id = %s "
            "order by created_at desc, id limit 1",
            (campagne,),
        )
        ligne = cur.fetchone()
    if ligne is None:
        return None
    mode = json.loads(str(ligne[7])).get("mode")
    prevue = StrategiePrevue(
        total_budget=_dec(ligne[1]),
        forecast_cpm=_dec(ligne[2]),
        jour_debut=_jour(ligne[3]),
        jour_fin=_jour(ligne[4]),
        kpi_target=_dec(ligne[5]),
        objective_code=None if ligne[6] is None else str(ligne[6]),
    )
    return str(ligne[0]), StrategieSuivi(prevue, mode if isinstance(mode, str) else None)


def lire_plan(connexion: psycopg.Connection[Any], strategie: str) -> list[LignePlan]:
    """Les lignes de `bidding_zone_configs` de la stratégie (actives ou non : le noyau filtre)."""
    with connexion.cursor() as cur:
        cur.execute(
            "select postal_code, bid_multiplier::text, part_prevue::text, is_active from public.bidding_zone_configs "
            'where strategy_id = %s order by postal_code collate "C", country_code collate "C"',
            (strategie,),
        )
        return [LignePlan(str(cp), Decimal(str(m)), _dec(p), bool(a)) for cp, m, p, a in cur.fetchall()]


def lire_rollup_cp(connexion: psycopg.Connection[Any], campagne: str) -> list[LigneCp]:
    with connexion.cursor() as cur:
        cur.execute(
            "select postal_code, actor, dept, impressions, spend::text, imps_7d, imps_prev7d, in_target, "
            "planned_share::text from public.campaign_cp_rollup where campaign_id = %s "
            'order by postal_code collate "C", actor collate "C"',
            (campagne,),
        )
        return [
            LigneCp(
                str(cp),
                str(a),
                None if d is None else str(d),
                int(i),
                Decimal(str(s)),
                int(i7),
                int(p7),
                bool(c),
                _dec(p),
            )
            for cp, a, d, i, s, i7, p7, c, p in cur.fetchall()
        ]


def lire_rollup_jour(connexion: psycopg.Connection[Any], campagne: str) -> list[LigneJour]:
    with connexion.cursor() as cur:
        cur.execute(
            "select date, media, actor, impressions, spend::text from public.campaign_daily_rollup "
            'where campaign_id = %s order by date, media collate "C", actor collate "C"',
            (campagne,),
        )
        return [LigneJour(j.toordinal(), str(m), str(a), int(i), Decimal(str(s))) for j, m, a, i, s in cur.fetchall()]


def lire_referentiel(connexion: psycopg.Connection[Any], codes: list[str]) -> Referentiel:
    """Département des codes demandés, et les tables complètes des départements et régions (≈ 100 et ≈ 20 lignes)."""
    with connexion.cursor() as cur:
        cur.execute(
            "select code_postal, code_dept from public.ref_codes_postaux where code_postal = any(%s::text[]) "
            'order by code_postal collate "C"',
            (codes,),
        )
        dept_du_cp = {str(cp): None if d is None else str(d) for cp, d in cur.fetchall()}
        cur.execute(
            'select code_dept, nom_dept, code_region from public.ref_departements order by code_dept collate "C"'
        )
        departements = {
            str(d): (None if n is None else str(n), None if r is None else str(r)) for d, n, r in cur.fetchall()
        }
        cur.execute('select code_region, nom_region from public.ref_regions order by code_region collate "C"')
        regions = {str(r): str(n) for r, n in cur.fetchall()}
    return Referentiel(dept_du_cp, departements, regions)
