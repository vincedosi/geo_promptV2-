"""INTÉGRATION (base LOCALE, rôle `optimisation_service`, lecture seule) : les lecteurs des mesures relisent les entrées
figées par la fixture, et le noyau rend depuis elles le score 93 et les 161 CP sous le plan.

`ref_departements` et `ref_regions` exigent sql/343 : sans lui, le test du référentiel est SAUTÉ en le disant.
"""

from collections.abc import Iterator
from dataclasses import astuple

import psycopg
import pytest

from optimisation.lecture.mesures import (
    lire_parametres_campagne,
    lire_plan,
    lire_referentiel,
    lire_rollup_cp,
    lire_rollup_jour,
    lire_strategie_suivi,
)
from optimisation.noyau.mesures import alignement_geo, alignement_par_maille, suivi
from optimisation.noyau.numeric_pg import texte
from optimisation.noyau.prevu import attendu_a_date
from tests.lecture.test_base_locale import URL, pytestmark  # noqa: F401  (même garde : base locale joignable)
from tests.parite import test_mesures as fx

CAMPAGNE = "dccc0000-0000-4000-8000-000000000002"


@pytest.fixture
def conn() -> Iterator[psycopg.Connection[tuple[object, ...]]]:
    assert URL is not None and "@127.0.0.1:54322/" in URL
    with psycopg.connect(URL, connect_timeout=5) as c:
        c.read_only = True
        yield c


def test_lecteurs_rendent_les_entrees_figees(conn: psycopg.Connection[tuple[object, ...]]) -> None:
    assert lire_parametres_campagne(conn, CAMPAGNE) == fx.campagne()
    assert lire_parametres_campagne(conn, "00000000-0000-0000-0000-00000000dead") is None
    lu = lire_strategie_suivi(conn, CAMPAGNE)
    assert lu is not None and lu[1] == fx.strategie()
    assert [astuple(x) for x in lire_rollup_cp(conn, CAMPAGNE)] == [astuple(x) for x in fx.lignes_cp()]
    assert [astuple(x) for x in lire_rollup_jour(conn, CAMPAGNE)] == [astuple(x) for x in fx.lignes_jour()]


def test_mesures_de_bout_en_bout(conn: psycopg.Connection[tuple[object, ...]]) -> None:
    lu = lire_strategie_suivi(conn, CAMPAGNE)
    assert lu is not None
    id_strategie, strategie = lu
    cps, jours = lire_rollup_cp(conn, CAMPAGNE), lire_rollup_jour(conn, CAMPAGNE)
    score = alignement_geo(cps, lire_parametres_campagne(conn, CAMPAGNE))
    assert texte(score["score"]) == "93"
    plan = [ligne.multiplicateur for ligne in lire_plan(conn, id_strategie) if ligne.actif]
    attendu = attendu_a_date(strategie.prevue, max(j.jour for j in jours))
    r = suivi(strategie, jours, cps, plan, attendu)
    assert texte(r["pacing"]["index"]) == "0.80"
    assert any(a["title"] == "161 CP cibles sous 70 % du plan" for a in r["alerts"])


def test_referentiel_et_ecarts_par_departement(conn: psycopg.Connection[tuple[object, ...]]) -> None:
    cps = lire_rollup_cp(conn, CAMPAGNE)
    try:
        ref = lire_referentiel(conn, sorted({x.code_postal for x in cps}))
    except psycopg.errors.InsufficientPrivilege:
        pytest.skip("sql/343 non appliqué : optimisation_service ne lit pas encore ref_departements / ref_regions")
    assert ref == fx.referentiel()
    r = alignement_par_maille(cps, ref, lire_parametres_campagne(conn, CAMPAGNE), "departement")
    ecarts = {u["code"]: texte(u["ecart_pct"]) for u in r["unites"] if u["ecart_pct"] is not None}
    assert (ecarts["13"], ecarts["59"]) == ("-48.4", "-46.2")
