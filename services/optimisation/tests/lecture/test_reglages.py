"""Réglages d'optimisation (tâche 2.3) : validation Pydantic, égalité des clés avec le CHECK SQL, et lecture cloisonnée
par espace contre la base LOCALE (rôle `optimisation_service`, écriture dans une transaction ANNULÉE).
"""

import re
from collections.abc import Iterator
from decimal import Decimal
from pathlib import Path

import psycopg
import pytest

from optimisation.lecture.reglages import (
    ALGO_DEFAUT,
    CampagneHorsEspace,
    ParametresOptimisation,
    ReglagesIllisibles,
    Seuils,
    lire_reglages,
    parametres_depuis_json,
)
from optimisation.noyau.mesures import SEUILS_DEFAUT
from optimisation.noyau.numeric_pg import texte
from tests.lecture.test_base_locale import URL, _joignable

SQL_345 = Path(__file__).resolve().parents[4] / "sql" / "345_optimisation_reglages.sql"
CAMPAGNE = "dccc0000-0000-4000-8000-000000000002"
ESPACE = "00000000-0000-0000-0000-000000000001"
AUTRE_ESPACE = "83cae295-9239-44b5-bb12-7a8b23448b01"


def test_defauts_egaux_aux_litteraux_d_avant() -> None:
    p = parametres_depuis_json("{}")
    assert p.seuils.du_suivi() == SEUILS_DEFAUT
    assert [texte(v) for v in (p.seuils.rythme_retard_grave, p.seuils.cp_sous_plan_pct)] == ["0.70", "70"]
    assert p.seuils.ecart_signale_pct == Decimal(20)
    assert (p.tableaux_depuis_plan, p.univers_methode_a) == (False, "fige")


def test_nombres_relus_sans_flottant() -> None:
    p = parametres_depuis_json('{"seuils": {"rythme_retard": 0.85, "cp_sous_plan_pct": 95.5}}')
    assert texte(p.seuils.rythme_retard) == "0.85"
    assert texte(p.seuils.cp_sous_plan_pct) == "95.5"


@pytest.mark.parametrize(
    "texte_json",
    [
        '{"seuils": {"cp_sous_plan": 50}}',  # faute de frappe
        '{"autre": 1}',
        '{"seuils": {"rythme_retard": "0.8"}}',  # nombre écrit en texte
        '{"seuils": {"fuite_pct": 0}}',
        '{"seuils": {"fuite_pct": -1}}',
        '{"seuils": {"rythme_retard_grave": 0.9}}',  # grave au-dessus du retard (0,85)
        '{"seuils": {"rythme_avance_grave": 1.1}}',  # grave sous l'avance (1,15)
        '{"seuils": {"rythme_retard": 1.2, "rythme_retard_grave": 0.7}}',  # retard au-dessus de l'avance
        '{"tableaux_depuis_plan": "oui"}',
        '{"univers_methode_a": "livraison"}',
    ],
)
def test_parametres_refuses(texte_json: str) -> None:
    with pytest.raises(ReglagesIllisibles):
        parametres_depuis_json(texte_json)


def _cles_sql() -> tuple[set[str], set[str]]:
    corps = SQL_345.read_text(encoding="utf-8")
    seuils = re.search(r"where e\.cle not in \(([^)]*)\)", corps)
    racine = re.search(r"where k not in \(([^)]*)\)", corps)
    assert seuils is not None and racine is not None
    return set(re.findall(r"'(\w+)'", seuils.group(1))), set(re.findall(r"'(\w+)'", racine.group(1)))


def test_memes_cles_que_le_check_sql() -> None:
    seuils, racine = _cles_sql()
    assert seuils == set(Seuils.model_fields)
    assert racine == set(ParametresOptimisation.model_fields)


base = pytest.mark.skipif(not _joignable(), reason="base locale ou services/optimisation/.env absents")


@pytest.fixture
def conn() -> Iterator[psycopg.Connection[tuple[object, ...]]]:
    assert URL is not None and "@127.0.0.1:54322/" in URL
    with psycopg.connect(URL, connect_timeout=5) as c:
        yield c
        c.rollback()


@base
def test_sans_ligne_tous_les_defauts(conn: psycopg.Connection[tuple[object, ...]]) -> None:
    r = lire_reglages(conn, CAMPAGNE, ESPACE)
    assert (r.enregistre, r.algo_id, r.workspace_id) == (False, ALGO_DEFAUT, ESPACE)
    assert r.parametres == ParametresOptimisation()


@base
def test_autre_espace_ou_campagne_inconnue_refuses(conn: psycopg.Connection[tuple[object, ...]]) -> None:
    with pytest.raises(CampagneHorsEspace):
        lire_reglages(conn, CAMPAGNE, AUTRE_ESPACE)
    with pytest.raises(CampagneHorsEspace):
        lire_reglages(conn, "00000000-0000-0000-0000-00000000dead", ESPACE)


@base
def test_ligne_ecrite_relue_puis_annulee(conn: psycopg.Connection[tuple[object, ...]]) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "insert into public.optimisation_reglages (campagne_id, workspace_id, parametres) values (%s, %s, %s)",
            (CAMPAGNE, ESPACE, '{"seuils": {"cp_sous_plan_pct": 50}, "tableaux_depuis_plan": true}'),
        )
    r = lire_reglages(conn, CAMPAGNE, ESPACE)
    assert r.enregistre and r.algo_id == ALGO_DEFAUT
    assert texte(r.parametres.seuils.cp_sous_plan_pct) == "50"
    assert r.parametres.tableaux_depuis_plan is True
    # Un autre espace ne voit pas cette ligne, même par la campagne.
    with pytest.raises(CampagneHorsEspace):
        lire_reglages(conn, CAMPAGNE, AUTRE_ESPACE)


@base
def test_le_check_sql_refuse_ce_que_pydantic_refuse(conn: psycopg.Connection[tuple[object, ...]]) -> None:
    with conn.cursor() as cur, pytest.raises(psycopg.errors.CheckViolation):
        cur.execute(
            "insert into public.optimisation_reglages (campagne_id, workspace_id, parametres) values (%s, %s, %s)",
            (CAMPAGNE, ESPACE, '{"seuils": {"rythme_retard_grave": 0.9}}'),
        )


@base
def test_optimisation_service_ne_supprime_pas(conn: psycopg.Connection[tuple[object, ...]]) -> None:
    with conn.cursor() as cur, pytest.raises(psycopg.errors.InsufficientPrivilege):
        cur.execute("delete from public.optimisation_reglages where campagne_id = %s", (CAMPAGNE,))
