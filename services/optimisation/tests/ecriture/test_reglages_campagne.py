"""Écriture des réglages de DONNÉES d'une campagne (relecture de la phase 2, I3) contre la base LOCALE, rôle
`optimisation_service`, chaque test dans une transaction ANNULÉE.

Vérifie : défaut sur une campagne sans réglage (rien écrit), premier réglage (ligne créée, journal `reglages` avec
avant / après exacts, sans flottant), même réglage effectif (rien écrit), remplacement (clé absente = défaut),
`tableaux_a_reconstruire` seulement quand la bascule change, autre espace (refus, rien écrit), journaux séparés
(`lire_algo_campagne` ne voit pas une ligne de réglages), CHECK des bornes de sql/350.
"""

from collections.abc import Iterator
from decimal import Decimal
from typing import Any

import psycopg
import pytest

from optimisation.ecriture.algo_campagne import lire_algo_campagne
from optimisation.ecriture.reglages_campagne import (
    ResultatReglages,
    ecrire_reglages_campagne,
    lire_reglages_campagne,
)
from optimisation.lecture.reglages import CampagneHorsEspace, lire_reglages
from tests.lecture.test_base_locale import URL, _joignable

CAMPAGNE = "dccc0000-0000-4000-8000-000000000002"
ESPACE = "00000000-0000-0000-0000-000000000001"
AUTRE_ESPACE = "83cae295-9239-44b5-bb12-7a8b23448b01"

pytestmark = pytest.mark.skipif(not _joignable(), reason="base locale ou services/optimisation/.env absents")


@pytest.fixture
def conn() -> Iterator[psycopg.Connection[tuple[object, ...]]]:
    assert URL is not None and "@127.0.0.1:54322/" in URL
    with psycopg.connect(URL, connect_timeout=5) as c:
        with c.cursor() as cur:
            cur.execute("select count(*) from public.optimisation_reglages where campagne_id = %s", (CAMPAGNE,))
            assert cur.fetchone() == (0,), "réglage déjà présent sur la campagne de démo"
        yield c
        c.rollback()


def _ecrire(
    conn: psycopg.Connection[tuple[object, ...]], brut: dict[str, Any], espace: str = ESPACE
) -> ResultatReglages:
    return ecrire_reglages_campagne(
        conn, campagne=CAMPAGNE, espace=espace, utilisateur=None, role="admin", brut=brut, version_algo=lambda _a: 1
    )


def _journal(conn: psycopg.Connection[tuple[object, ...]]) -> list[tuple[Any, ...]]:
    with conn.cursor() as cur:
        cur.execute(
            "select nature, algo_avant, algo_apres, reglages_avant::text, reglages_apres::text "
            "from public.optimisation_reglages_journal where campagne_id = %s order by modifie_le, id",
            (CAMPAGNE,),
        )
        return cur.fetchall()


def test_defaut_sur_campagne_sans_reglage_rien_ecrit(conn: psycopg.Connection[tuple[object, ...]]) -> None:
    r = _ecrire(conn, {})
    assert (r.change, r.entree, r.etat.enregistre, r.tableaux_a_reconstruire) == (False, None, False, False)
    assert _ecrire(conn, {"seuils": {"cp_sous_plan_pct": Decimal(70)}}).change is False  # 70 = le défaut
    assert _journal(conn) == []


def test_premier_reglage_puis_remplacement(conn: psycopg.Connection[tuple[object, ...]]) -> None:
    r = _ecrire(conn, {"seuils": {"cp_sous_plan_pct": Decimal(50), "rythme_retard": Decimal("0.85")}})
    assert r.change and r.etat.enregistre and not r.tableaux_a_reconstruire
    assert r.entree is not None and r.entree.avant == {}
    assert r.entree.apres == {"seuils": {"cp_sous_plan_pct": Decimal(50), "rythme_retard": Decimal("0.85")}}
    # Relu par le lecteur du suivi : la même valeur, sans flottant.
    assert str(lire_reglages(conn, CAMPAGNE, ESPACE).parametres.seuils.rythme_retard) == "0.85"
    # Même réglage effectif : rien écrit.
    assert _ecrire(conn, {"seuils": {"cp_sous_plan_pct": Decimal(50)}}).change is False
    # Remplacement : la bascule allumée, le seuil revient au défaut (clé absente).
    r2 = _ecrire(conn, {"tableaux_depuis_plan": True})
    assert r2.change and r2.tableaux_a_reconstruire
    assert r2.etat.effectifs.seuils.cp_sous_plan_pct == Decimal(70)
    assert (
        _ecrire(conn, {"tableaux_depuis_plan": True, "univers_methode_a": "referentiel"}).tableaux_a_reconstruire
        is False
    )
    journal = _journal(conn)
    assert [j[0] for j in journal] == ["reglages"] * 3
    assert all(j[1] == j[2] == "uniformiser_global" for j in journal)  # l'algorithme ne change pas
    # Une seule transaction : `modifie_le` (now()) est le même pour les trois lignes, l'ordre n'est pas comparé ici —
    # chaque « avant » est le « après » d'une autre ligne, ou `{}` pour le premier.
    paires = {(j[3], j[4]) for j in journal}
    assert paires == {
        ("{}", '{"seuils": {"rythme_retard": 0.85, "cp_sous_plan_pct": 50}}'),
        ('{"seuils": {"rythme_retard": 0.85, "cp_sous_plan_pct": 50}}', '{"tableaux_depuis_plan": true}'),
        ('{"tableaux_depuis_plan": true}', '{"univers_methode_a": "referentiel", "tableaux_depuis_plan": true}'),
    }
    assert len(lire_reglages_campagne(conn, CAMPAGNE, ESPACE).journal) == 3
    # Le journal de l'algorithme ne mélange pas les deux natures.
    assert lire_algo_campagne(conn, CAMPAGNE, ESPACE).journal == []


def test_autre_espace_refuse_rien_ecrit(conn: psycopg.Connection[tuple[object, ...]]) -> None:
    with pytest.raises(CampagneHorsEspace):
        _ecrire(conn, {"tableaux_depuis_plan": True}, espace=AUTRE_ESPACE)
    with pytest.raises(CampagneHorsEspace):
        lire_reglages_campagne(conn, CAMPAGNE, AUTRE_ESPACE)
    assert _journal(conn) == []


@pytest.mark.parametrize("seuils", ['{"cp_sous_plan_pct": 100.5}', '{"fuite_pct": 1e400}', '{"cpm_depassement": 11}'])
def test_check_bornes_hautes(conn: psycopg.Connection[tuple[object, ...]], seuils: str) -> None:
    with conn.cursor() as cur, pytest.raises(psycopg.errors.CheckViolation):
        cur.execute(
            "insert into public.optimisation_reglages (campagne_id, workspace_id, parametres) values (%s, %s, %s)",
            (CAMPAGNE, ESPACE, f'{{"seuils": {seuils}}}'),
        )
