"""INTÉGRATION (base LOCALE, `optimisation_service`, lecture seule) — tâche 2.2 : plan méthode A sur le référentiel
complet des codes postaux (`univers_methode_a = 'referentiel'`), comparé à l'univers figé de la phase 1 (`fige`).

Effet mesuré sur la démo « élections » (rapport de la tâche 2.4) :
- référentiel : 6 187 codes ; univers figé : 11 435 = les 6 187 + 5 248 codes étrangers, tous à 0 ;
- sur les 6 187 codes communs, multiplicateurs IDENTIQUES (le calcul est code par code) ; 1 641 > 0 dans les deux ;
- par rapport à l'univers que le SQL lirait AUJOURD'HUI (`DISTINCT dsp_campaign_data`, 11 415 codes dont 6 167 du
  référentiel — mesuré le 05/11 en `postgres`, `optimisation_service` n'a pas le droit de lire cette table) : le
  référentiel RAJOUTE 20 codes jamais livrés nulle part (`SANS_LIVRAISON` ci-dessous), tous à 0 pour cette stratégie.
"""

from collections.abc import Iterator
from decimal import Decimal

import psycopg
import pytest

from optimisation.lecture.plan_methode_a import (
    lire_codes_zone,
    lire_strategie,
    lire_univers,
    lire_valeurs_indicateur,
)
from optimisation.noyau.pression import multiplicateurs_methode_a, variable_de
from tests.lecture.test_base_locale import URL, pytestmark  # noqa: F401  (même garde : base locale joignable)

CAMPAGNE = "dccc0000-0000-4000-8000-000000000002"
# Les 20 codes du référentiel absents de `DISTINCT dsp_campaign_data` le 05/11 (psql, rôle postgres).
SANS_LIVRAISON = (
    "05480 09390 17123 20141 20153 20164 20173 20275 22870 29253 29259 29990 97128 97136 97137 97140 97316 97319 "
    "97625 97680"
).split()


@pytest.fixture
def conn() -> Iterator[psycopg.Connection[tuple[object, ...]]]:
    assert URL is not None and "@127.0.0.1:54322/" in URL
    with psycopg.connect(URL, connect_timeout=5) as c:
        c.read_only = True
        yield c


def _multiplicateurs(conn: psycopg.Connection[tuple[object, ...]], univers: list[str]) -> dict[str, Decimal]:
    s = lire_strategie(conn, CAMPAGNE)
    zone = lire_codes_zone(conn, s.zone_id) if s.zone_id else []
    valeurs = lire_valeurs_indicateur(conn, variable_de(s.poids_en_zone), univers)
    return multiplicateurs_methode_a(univers, s.zone_id is not None, zone, valeurs, s.poids_en_zone, s.poids_hors_zone)


def test_referentiel_contre_univers_fige(conn: psycopg.Connection[tuple[object, ...]]) -> None:
    s = lire_strategie(conn, CAMPAGNE)
    fige = lire_univers(conn, s.id, "fige")
    referentiel = lire_univers(conn, s.id, "referentiel")
    assert (len(fige), len(referentiel)) == (11_435, 6_187)
    assert set(referentiel) <= set(fige)

    m_fige = _multiplicateurs(conn, fige)
    m_ref = _multiplicateurs(conn, referentiel)
    etrangers = set(fige) - set(referentiel)
    assert len(etrangers) == 5_248
    assert all(m_fige[cp] == 0 for cp in etrangers)
    assert {cp: m_fige[cp] for cp in referentiel} == m_ref
    assert len([m for m in m_ref.values() if m > 0]) == len([m for m in m_fige.values() if m > 0]) == 1_641


def test_les_20_codes_jamais_livres_entrent(conn: psycopg.Connection[tuple[object, ...]]) -> None:
    s = lire_strategie(conn, CAMPAGNE)
    referentiel = lire_univers(conn, s.id, "referentiel")
    assert set(SANS_LIVRAISON) <= set(referentiel)
    m_ref = _multiplicateurs(conn, referentiel)
    assert [m_ref[cp] for cp in SANS_LIVRAISON] == [Decimal("0.000")] * 20
