"""Générateur des fixtures de parité SQL de la phase 1 (1.1 méthode A, 1.2 part du plan et attendu, 1.3 mesures).

La référence est le SQL ACTUEL de la base locale : on lit les entrées figées de la campagne « Démo pilotage —
élections » et les SORTIES des fonctions (`interpolate_on_curve`, `get_campaign_expected`, `calculer_alignement_geo`,
`alignement_par_maille`, `get_campaign_suivi`) et des tables qu'elles ont écrites (`bidding_zone_configs`,
`campaign_cp_rollup`). Toute valeur `numeric` est lue en TEXTE : son échelle (`10.00`, `4920000.0000…`) fait partie de
la sortie.

LECTURE SEULE : la connexion est ouverte `read_only` (toute écriture lève), et l'hôte doit être 127.0.0.1. Le rôle
`optimisation_service` n'a pas le droit de lire `indicator_cp_values`, `custom_geo_zone_codes`, `ref_departements` ni
`ref_regions` (sql/342) : l'URL est donc fournie à part, jamais écrite ici. Lancement, depuis `services/optimisation` :

    PARITE_SQL_URL=postgresql://<role>:<mdp>@127.0.0.1:54322/postgres uv run python -m tests.parite.generer_fixtures_sql

Les requêtes sont séquentielles (une à la fois), toutes en ordre TOTAL (plan § 11).
"""

import gzip
import json
import os
import sys
from pathlib import Path
from typing import Any

import psycopg

CAMPAGNE = "dccc0000-0000-4000-8000-000000000002"
FIXTURES = Path(__file__).resolve().parent / "fixtures"

COURBES_LIMITES = [
    "[]",
    "null",
    "{}",
    '[{"x": 10, "y": 2}]',
    '[{"x": 20, "y": 0.63}, {"x": 20, "y": 1}, {"x": 45, "y": 1.6}]',
    '[{"x": 45, "y": 1.6}, {"x": 30, "y": 1}, {"x": 20, "y": 0.63}]',
    '[{"x": 0, "y": 0}, {"x": 3, "y": 1}, {"x": 7, "y": 2.5}]',
    '[{"x": 0.001, "y": 0.123456}, {"x": 1000, "y": 7}]',
    '[{"y": 1}, {"x": 5, "y": 2}, {"x": 9, "y": 3}]',
    '[{"x": 1}, {"x": 5, "y": 2}, {"x": 9, "y": 3}]',
    '[{"x": 1, "y": 1}, {"x": 5}, {"x": 9, "y": 3}]',
    '[{"x": 1, "y": 0.5}, {"x": 5, "y": 2.25}, {"x": 9, "y": 6}]',
]
X_LIMITES = ["-1", "0", "1.5", "3", "4.99", "5", "10", "12.15", "20", "25", "29.999", "30", "44", "45", "50", "100"]

NOMBRES = [
    "0",
    "0.000",
    "1",
    "-1",
    "3",
    "7",
    "10",
    "100.0",
    "0.5",
    "-2.5",
    "0.0001",
    "0.9",
    "1.1",
    "1.214",
    "1700.000",
    "6.5000",
    "25689.9000",
    "3936390",
    "99999999",
    "12345.6789",
    "0.00085284071829701618",
    "65000.00",
    "0.492",
    "49.2",
    "61",
    "30",
]
ARRONDIS = ["2.5", "-2.5", "0.0005", "1.2345", "-1.2345", "0.4999999999", "4920000.0000000000000000000000", "93.5"]


def _url() -> str:
    url = os.environ.get("PARITE_SQL_URL", "").strip()
    if not url:
        sys.exit("PARITE_SQL_URL absente (URL Postgres de la base LOCALE, hôte 127.0.0.1)")
    if "@127.0.0.1:" not in url:
        sys.exit("PARITE_SQL_URL doit viser 127.0.0.1 : ce générateur ne lit QUE la base locale")
    return url


def _ecrire(nom: str, contenu: dict[str, Any]) -> None:
    donnees = json.dumps(contenu, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    # mtime=0 : deux générations successives rendent le même fichier octet pour octet.
    (FIXTURES / nom).write_bytes(gzip.compress(donnees, mtime=0))
    print(f"{nom} : {len(donnees)} octets JSON")


def _lignes(cur: psycopg.Cursor[Any], requete: str, params: tuple[Any, ...] = ()) -> list[list[Any]]:
    cur.execute(requete.encode("utf-8"), params)
    return [list(r) for r in cur.fetchall()]


def _une(cur: psycopg.Cursor[Any], requete: str, params: tuple[Any, ...] = ()) -> Any:
    cur.execute(requete.encode("utf-8"), params)
    ligne = cur.fetchone()
    assert ligne is not None
    return ligne[0]


def generer_numeric(cur: psycopg.Cursor[Any], courbe_demo: str, valeurs_demo: list[str]) -> None:
    divisions = _lignes(
        cur,
        "select a, b, (a::numeric / b::numeric)::text from unnest(%s::text[]) with ordinality as x(a, i) "
        "cross join unnest(%s::text[]) with ordinality as y(b, j) where b::numeric <> 0 order by i, j",
        (NOMBRES, NOMBRES),
    )
    arrondis = _lignes(
        cur,
        "select v, n, round(v::numeric, n)::text from unnest(%s::text[]) with ordinality as x(v, i) "
        "cross join generate_series(0, 3) as n order by i, n",
        (ARRONDIS,),
    )
    interpolations: list[dict[str, Any]] = []
    for courbe, xs in [(courbe_demo, [*valeurs_demo, *X_LIMITES])] + [(c, X_LIMITES) for c in COURBES_LIMITES]:
        lignes = _lignes(
            cur,
            "select x, public.interpolate_on_curve(%s::jsonb, x::numeric)::text "
            "from unnest(%s::text[]) with ordinality as t(x, i) order by i",
            (courbe, xs),
        )
        nul = _une(cur, "select public.interpolate_on_curve(%s::jsonb, null)::text", (courbe,))
        interpolations.append({"courbe": courbe, "points": [*lignes, [None, nul]]})
    _ecrire(
        "sql-numeric.json.gz",
        {
            "format": 1,
            "genere_par": "tests/parite/generer_fixtures_sql.py",
            "divisions": divisions,
            "arrondis": arrondis,
            "interpolations": interpolations,
        },
    )


def generer_demo(cur: psycopg.Cursor[Any]) -> None:
    strategie = _lignes(
        cur,
        "select id::text, zone_id::text, in_zone_weights::text, out_zone_weights::text, total_budget::text, "
        "forecast_cpm::text, start_date::text, end_date::text, kpi_target::text, objective_code "
        "from public.bidding_strategies where campaign_id = %s order by created_at desc, id limit 1",
        (CAMPAGNE,),
    )[0]
    cle = [
        "id",
        "zone_id",
        "in_zone_weights",
        "out_zone_weights",
        "total_budget",
        "forecast_cpm",
        "start_date",
        "end_date",
        "kpi_target",
        "objective_code",
    ]
    s = dict(zip(cle, strategie, strict=True))
    variable = json.loads(s["in_zone_weights"]).get("variable_code") or "abstention_pres_2022"

    bzc = _lignes(
        cur,
        "select postal_code, country_code, bid_multiplier::text, part_prevue::text, is_active "
        "from public.bidding_zone_configs where strategy_id = %s "
        'order by postal_code collate "C", country_code collate "C"',
        (s["id"],),
    )
    univers = sorted({ligne[0] for ligne in bzc})
    zone = (
        [
            r[0]
            for r in _lignes(
                cur,
                "select code from public.custom_geo_zone_codes where zone_id = %s and code_type = 'cp' "
                'group by code order by code collate "C"',
                (s["zone_id"],),
            )
        ]
        if s["zone_id"]
        else []
    )
    valeurs = _lignes(
        cur,
        "select postal_code, value::text from public.indicator_cp_values "
        'where indicator_code = %s and postal_code = any(%s::text[]) order by postal_code collate "C"',
        (variable, univers),
    )
    campagne = _lignes(
        cur,
        "select tolerance_pct::text, overpressure_weight::text, dsp_source from public.dsp_campaigns where id = %s",
        (CAMPAGNE,),
    )[0]
    cp_rollup = _lignes(
        cur,
        "select postal_code, actor, dept, impressions::text, spend::text, imps_7d::text, imps_prev7d::text, "
        "in_target, planned_share::text from public.campaign_cp_rollup where campaign_id = %s "
        'order by postal_code collate "C", actor collate "C"',
        (CAMPAGNE,),
    )
    daily = _lignes(
        cur,
        "select date::text, media, actor, impressions::text, spend::text from public.campaign_daily_rollup "
        'where campaign_id = %s order by date, media collate "C", actor collate "C"',
        (CAMPAGNE,),
    )
    codes_livres = sorted({r[0] for r in cp_rollup})
    ref_cp = _lignes(
        cur,
        "select code_postal, code_dept from public.ref_codes_postaux where code_postal = any(%s::text[]) "
        'order by code_postal collate "C"',
        (codes_livres,),
    )
    ref_dept = _lignes(
        cur, 'select code_dept, nom_dept, code_region from public.ref_departements order by code_dept collate "C"'
    )
    ref_reg = _lignes(cur, 'select code_region, nom_region from public.ref_regions order by code_region collate "C"')

    # Copie LITTÉRALE du CTE `plan` de `refresh_campaign_rollups` (sql/306, A8), sur TOUTES les lignes du plan (le
    # rollup ne garde que les codes livrés).
    plan_cte = _lignes(
        cur,
        "select z.postal_code, (case when bool_or(z.part_prevue is not null) over () then z.part_prevue "
        "else z.bid_multiplier / nullif(sum(z.bid_multiplier) over (), 0) end)::text, "
        "case when (s.out_zone_weights->>'mode') = 'exclusion' then z.bid_multiplier > 0 "
        "else z.bid_multiplier > 1 end "
        "from public.bidding_zone_configs z join public.bidding_strategies s on s.id = z.strategy_id "
        'where z.strategy_id = %s and z.is_active order by z.postal_code collate "C", z.country_code collate "C"',
        (s["id"],),
    )

    attendu = _une(cur, "select public.get_campaign_expected(%s)::text", (CAMPAGNE,))
    alignements = []
    for tol, poids in [("10", "1.0"), (None, None), ("20", "0.5"), ("0", "2"), ("12.5", "0.75")]:
        sortie = _une(
            cur, "select public.calculer_alignement_geo(%s, %s::numeric, %s::numeric)::text", (CAMPAGNE, tol, poids)
        )
        alignements.append({"tolerance": tol, "poids": poids, "sortie": sortie})
    mailles = []
    for maille, parent, tol, limite in [
        ("region", None, None, 500),
        ("departement", None, None, 500),
        ("cp", None, None, 500),
        ("departement", "93", None, 500),
        ("cp", "13", None, 500),
        ("cp", None, "20", 5000),
        ("departement", None, "5", 10),
    ]:
        sortie = _une(
            cur,
            "select public.alignement_par_maille(%s, %s, %s, %s::numeric, %s)::text",
            (CAMPAGNE, maille, parent, tol, limite),
        )
        mailles.append({"maille": maille, "parent": parent, "tolerance": tol, "limite": limite, "sortie": sortie})
    suivis = []
    for acteurs in [None, ["dv360"], ["ttd", "tiktok"], ["inconnu"]]:
        sortie = _une(cur, "select public.get_campaign_suivi(%s, %s::text[])::text", (CAMPAGNE, acteurs))
        suivis.append({"acteurs": acteurs, "sortie": sortie})

    _ecrire(
        "demo-elections.json.gz",
        {
            "format": 1,
            "genere_par": "tests/parite/generer_fixtures_sql.py",
            "campagne": CAMPAGNE,
            "entrees": {
                "strategie": s,
                "variable": variable,
                "univers": univers,
                "codes_zone": zone,
                "valeurs_indicateur": valeurs,
                "bidding_zone_configs": bzc,
                "campagne": dict(zip(["tolerance_pct", "overpressure_weight", "dsp_source"], campagne, strict=True)),
                "campaign_cp_rollup": cp_rollup,
                "campaign_daily_rollup": daily,
                "ref_codes_postaux": ref_cp,
                "ref_departements": ref_dept,
                "ref_regions": ref_reg,
            },
            "sorties": {
                "plan_cte": plan_cte,
                "get_campaign_expected": attendu,
                "calculer_alignement_geo": alignements,
                "alignement_par_maille": mailles,
                "get_campaign_suivi": suivis,
            },
        },
    )
    generer_numeric(cur, json.dumps(json.loads(s["in_zone_weights"])["curve"]), sorted({v for _, v in valeurs}))


def main() -> None:
    with psycopg.connect(_url(), connect_timeout=5, application_name="parite_fixtures_sql") as conn:
        conn.read_only = True
        with conn.cursor() as cur:
            cur.execute(b"set statement_timeout = '30s'")
            generer_demo(cur)


if __name__ == "__main__":
    main()
