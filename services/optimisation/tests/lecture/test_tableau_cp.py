"""INTÉGRATION (base LOCALE, `optimisation_service`, lecture seule) — tâche 2.1 sur les campagnes réelles.

- démo « élections » : les 1 641 codes du plan sont TOUS servis → le tableau depuis le plan est le rollup tel quel
  (0 code ajouté : la correction ne se voit pas sur la démo, il faut le dire) ;
- les deux campagnes à stratégie mais sans aucune livraison (jeu de zone, 88 codes chacune) : rien avant, 88 codes à
  0 après.
"""

from collections.abc import Iterator

import psycopg
import pytest

from optimisation.lecture.mesures import lire_rollup_cp, lire_tableau_cp
from tests.lecture.test_base_locale import URL, pytestmark  # noqa: F401  (même garde : base locale joignable)

DEMO = "dccc0000-0000-4000-8000-000000000002"
SANS_LIVRAISON = ("4935811d-8b09-44c5-bbaf-ac0b3c5e07b5", "ba49acd8-1daa-4953-bd61-99f427a39397")


@pytest.fixture
def conn() -> Iterator[psycopg.Connection[tuple[object, ...]]]:
    assert URL is not None and "@127.0.0.1:54322/" in URL
    with psycopg.connect(URL, connect_timeout=5) as c:
        c.read_only = True
        yield c


def test_demo_aucun_code_non_servi(conn: psycopg.Connection[tuple[object, ...]]) -> None:
    rollup = lire_rollup_cp(conn, DEMO)
    assert lire_tableau_cp(conn, DEMO, depuis_plan=False) == rollup
    assert lire_tableau_cp(conn, DEMO, depuis_plan=True) == rollup
    assert len({x.code_postal for x in rollup}) == 2_041


@pytest.mark.parametrize("campagne", SANS_LIVRAISON)
def test_campagnes_sans_livraison_88_codes_apparaissent(
    conn: psycopg.Connection[tuple[object, ...]], campagne: str
) -> None:
    if lire_rollup_cp(conn, campagne):
        pytest.skip("rollup déjà rafraîchi depuis le plan sur cette base : rien à comparer")
    assert lire_tableau_cp(conn, campagne, depuis_plan=False) == []
    tableau = lire_tableau_cp(conn, campagne, depuis_plan=True)
    assert len(tableau) == 88
    assert all(x.acteur == "" and x.impressions == 0 and (x.en_cible or (x.part_plan or 0) > 0) for x in tableau)
