"""Écriture de l'algorithme d'une campagne et de son journal (tâche 2.7) contre la base LOCALE, rôle
`optimisation_service`, chaque test dans une transaction ANNULÉE : aucune ligne ne reste.

Vérifie : premier choix (ligne créée, journal « avant » = défaut), choix suivant (journal « avant » = choix d'avant),
même choix (rien écrit), défaut sur une campagne sans réglage (aucune ligne créée), campagne d'un autre espace
(refus, RIEN écrit), le journal relu par l'espace et pas par un autre, et les droits du rôle (journal en ajout seul).
"""

from collections.abc import Iterator

import psycopg
import pytest

from optimisation.ecriture.algo_campagne import ResultatEcriture, ecrire_algo_campagne, lire_algo_campagne
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
            # La campagne de démo ne doit porter aucun réglage AVANT le test (sinon les « avant » mentent).
            cur.execute("select count(*) from public.optimisation_reglages where campagne_id = %s", (CAMPAGNE,))
            ligne = cur.fetchone()
            assert ligne is not None and ligne[0] == 0, "réglage déjà présent sur la campagne de démo"
        yield c
        c.rollback()


def _ecrire(
    conn: psycopg.Connection[tuple[object, ...]], algo: str, surcharges: dict[str, float], espace: str = ESPACE
) -> ResultatEcriture:
    return ecrire_algo_campagne(
        conn,
        campagne=CAMPAGNE,
        espace=espace,
        utilisateur=None,
        role="admin",
        algo_id=algo,
        algo_version=1,
        surcharges=surcharges,
    )


def _compter(conn: psycopg.Connection[tuple[object, ...]], table: str) -> int:
    with conn.cursor() as cur:
        cur.execute(f"select count(*) from public.{table} where campagne_id = %s", (CAMPAGNE,))  # noqa: S608 — nom fixe
        ligne = cur.fetchone()
    assert ligne is not None
    return int(str(ligne[0]))


def test_defaut_sur_campagne_sans_reglage_ne_cree_rien(conn: psycopg.Connection[tuple[object, ...]]) -> None:
    r = _ecrire(conn, "uniformiser_global", {})
    assert r.change is False and r.entree is None and r.etat.enregistre is False
    assert _compter(conn, "optimisation_reglages") == 0
    assert _compter(conn, "optimisation_reglages_journal") == 0


def test_premier_puis_second_choix_journalises(conn: psycopg.Connection[tuple[object, ...]]) -> None:
    r1 = _ecrire(conn, "uniformiser_par_regie", {"alpha": 0.4})
    assert r1.change is True and r1.entree is not None
    assert (r1.entree.algo_avant, r1.entree.parametres_avant) == ("uniformiser_global", {})
    assert (r1.entree.algo_apres, r1.entree.parametres_apres) == ("uniformiser_par_regie", {"alpha": 0.4})
    assert r1.entree.role_auteur == "admin" and r1.entree.algo_version_apres == 1

    # Les réglages de la tâche 2.3 relisent l'algorithme et ses surcharges.
    lu = lire_reglages(conn, CAMPAGNE, ESPACE)
    assert (lu.algo_id, lu.algo_parametres, lu.enregistre) == ("uniformiser_par_regie", {"alpha": 0.4}, True)

    r2 = _ecrire(conn, "uniformiser_global", {"tolerance_global": 5})
    assert r2.entree is not None
    assert (r2.entree.algo_avant, r2.entree.parametres_avant) == ("uniformiser_par_regie", {"alpha": 0.4})
    assert r2.entree.parametres_apres == {"tolerance_global": 5.0}

    etat = lire_algo_campagne(conn, CAMPAGNE, ESPACE)
    assert etat.etat.algo_id == "uniformiser_global" and etat.etat.surcharges == {"tolerance_global": 5.0}
    # Même transaction : `now()` est figé, l'ordre secondaire est l'id ; on vérifie l'ensemble, pas l'ordre.
    assert {e.algo_apres for e in etat.journal} == {"uniformiser_par_regie", "uniformiser_global"}
    assert etat.journal_tronque is False


def test_meme_choix_rien_ecrit(conn: psycopg.Connection[tuple[object, ...]]) -> None:
    _ecrire(conn, "uniformiser_par_regie", {"alpha": 0.4})
    r = _ecrire(conn, "uniformiser_par_regie", {"alpha": 0.4})
    assert r.change is False and r.entree is None and r.etat.enregistre is True
    assert _compter(conn, "optimisation_reglages_journal") == 1


def test_journal_borne_et_tronque_signale(conn: psycopg.Connection[tuple[object, ...]]) -> None:
    for i in range(4):
        _ecrire(conn, "uniformiser_par_regie" if i % 2 == 0 else "uniformiser_global", {})
    etat = lire_algo_campagne(conn, CAMPAGNE, ESPACE, limite=3)
    assert len(etat.journal) == 3 and etat.journal_tronque is True


def test_autre_espace_refuse_et_rien_ecrit(conn: psycopg.Connection[tuple[object, ...]]) -> None:
    with pytest.raises(CampagneHorsEspace):
        _ecrire(conn, "uniformiser_par_regie", {}, espace=AUTRE_ESPACE)
    assert _compter(conn, "optimisation_reglages") == 0
    assert _compter(conn, "optimisation_reglages_journal") == 0
    with pytest.raises(CampagneHorsEspace):
        lire_algo_campagne(conn, CAMPAGNE, AUTRE_ESPACE)


def test_journal_en_ajout_seul_pour_le_service(conn: psycopg.Connection[tuple[object, ...]]) -> None:
    _ecrire(conn, "uniformiser_par_regie", {})
    with conn.cursor() as cur, pytest.raises(psycopg.errors.InsufficientPrivilege):
        cur.execute(
            "update public.optimisation_reglages_journal set algo_apres = 'x' where campagne_id = %s", (CAMPAGNE,)
        )


def test_le_check_refuse_une_surcharge_non_numerique(conn: psycopg.Connection[tuple[object, ...]]) -> None:
    with conn.cursor() as cur, pytest.raises(psycopg.errors.CheckViolation):
        cur.execute(
            "insert into public.optimisation_reglages (campagne_id, workspace_id, algo_parametres) values (%s, %s, %s)",
            (CAMPAGNE, ESPACE, '{"alpha": "0.4"}'),
        )
