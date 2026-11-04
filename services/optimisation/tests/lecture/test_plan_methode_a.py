"""INTÉGRATION (base LOCALE, rôle `optimisation_service`, lecture seule) : les lecteurs de la méthode A relisent les
entrées que la fixture a figées, et le noyau recalcule depuis elles les multiplicateurs écrits.

`custom_geo_zone_codes` et `indicator_cp_values` exigent sql/343 : sans lui, ces tests sont SAUTÉS en le disant.
"""

from collections.abc import Iterator
from decimal import Decimal

import psycopg
import pytest

from optimisation.lecture.plan_methode_a import (
    lire_codes_zone,
    lire_multiplicateurs,
    lire_strategie,
    lire_univers_fige,
    lire_valeurs_indicateur,
)
from optimisation.noyau.numeric_pg import texte
from optimisation.noyau.pression import multiplicateurs_methode_a, variable_de
from tests.lecture.test_base_locale import URL, pytestmark  # noqa: F401  (même garde : base locale joignable)
from tests.parite.demo_sql import entrees, json_decimal

CAMPAGNE = "dccc0000-0000-4000-8000-000000000002"


@pytest.fixture
def conn() -> Iterator[psycopg.Connection[tuple[object, ...]]]:
    assert URL is not None and "@127.0.0.1:54322/" in URL
    with psycopg.connect(URL, connect_timeout=5) as c:
        c.read_only = True
        yield c


def test_strategie_et_univers_figes(conn: psycopg.Connection[tuple[object, ...]]) -> None:
    e = entrees()
    s = lire_strategie(conn, CAMPAGNE)
    assert s.id == e["strategie"]["id"]
    assert s.zone_id == e["strategie"]["zone_id"]
    assert s.poids_en_zone == json_decimal(e["strategie"]["in_zone_weights"])
    assert lire_univers_fige(conn, s.id) == e["univers"]


def test_recalcul_depuis_la_base(conn: psycopg.Connection[tuple[object, ...]]) -> None:
    s = lire_strategie(conn, CAMPAGNE)
    univers = lire_univers_fige(conn, s.id)
    try:
        zone = lire_codes_zone(conn, s.zone_id) if s.zone_id else []
        valeurs = lire_valeurs_indicateur(conn, variable_de(s.poids_en_zone), univers)
    except psycopg.errors.InsufficientPrivilege:
        pytest.skip("sql/343 non appliqué : optimisation_service ne lit pas encore la zone ni l'indicateur")
    assert zone == entrees()["codes_zone"]
    assert {cp: texte(v) for cp, v in valeurs.items()} == dict(entrees()["valeurs_indicateur"])
    calcules = multiplicateurs_methode_a(
        univers, s.zone_id is not None, zone, valeurs, s.poids_en_zone, s.poids_hors_zone
    )
    ecrits = lire_multiplicateurs(conn, s.id)
    assert {cp: texte(m) for cp, m in calcules.items()} == {cp: texte(m) for cp, m in ecrits.items()}
    assert len([m for m in calcules.values() if m > Decimal(0)]) == 1_641
