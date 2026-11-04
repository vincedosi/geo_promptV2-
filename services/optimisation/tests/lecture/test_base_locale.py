"""INTÉGRATION contre la base LOCALE (jamais une autre) : lecteurs psycopg et route `/v1/plans/zone` de bout en bout.

L'URL est celle de `services/optimisation/.env` (rôle `optimisation_service`, non suivi par git), l'hôte du réseau
Docker remplacé par le port publié sur l'hôte (127.0.0.1:54322). Sans `.env` ou sans base joignable, ces tests sont
SAUTÉS en le disant (un poste sans stack local) ; ils ne tapent jamais un autre hôte que 127.0.0.1.

Lectures seules ; une connexion à la fois (pool ≤ 3).
"""

import re
from collections.abc import Iterator
from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient

from optimisation import base
from optimisation.api.app import app
from optimisation.lecture.registre import lire_poids
from optimisation.lecture.volumes import lire_volumes
from tests.parite.adaptation import ecarts
from tests.plans_fixtures import declinaison

ENV = Path(__file__).resolve().parents[2] / ".env"


def _url_hote() -> str | None:
    if not ENV.is_file():
        return None
    for ligne in ENV.read_text(encoding="utf-8").splitlines():
        if ligne.startswith("OPTIMISATION_DATABASE_URL="):
            url = ligne.split("=", 1)[1].strip()
            return re.sub(r"@[^@/]+/", "@127.0.0.1:54322/", url)
    return None


URL = _url_hote()


def _joignable() -> bool:
    if URL is None:
        return False
    try:
        with psycopg.connect(URL, connect_timeout=3):
            return True
    except psycopg.Error:
        return False


pytestmark = pytest.mark.skipif(not _joignable(), reason="base locale ou services/optimisation/.env absents")


@pytest.fixture
def conn() -> Iterator[psycopg.Connection[tuple[object, ...]]]:
    assert URL is not None and "@127.0.0.1:54322/" in URL
    with psycopg.connect(URL, connect_timeout=5) as c:
        yield c


def test_on_parle_a_la_base_locale_en_tant_que_optimisation_service(
    conn: psycopg.Connection[tuple[object, ...]],
) -> None:
    with conn.cursor() as cur:
        cur.execute("select current_user, inet_server_port()")
        assert cur.fetchone() == ("optimisation_service", 5432)


def test_lire_poids_rend_le_registre_que_le_ts_a_lu(conn: psycopg.Connection[tuple[object, ...]]) -> None:
    d = declinaison("strasbourg", "pondere-dv360-ttd")
    assert lire_poids(conn, ["ttd", "dv360"]) == d.poids


def test_lire_volumes_rend_les_volumes_que_le_ts_a_lus(conn: psycopg.Connection[tuple[object, ...]]) -> None:
    d = declinaison("strasbourg", "pondere-dv360-ttd")
    codes = [ligne["code"] for ligne in d.requete["couverture"]]
    lus = lire_volumes(conn, codes, "METRO")
    assert lus.univers == d.volumes.univers == "METRO"
    assert lus.total == d.volumes.total
    assert dict(lus.par_code) == dict(d.volumes.par_code)


def test_route_plan_zone_de_bout_en_bout_contre_la_base(monkeypatch: pytest.MonkeyPatch) -> None:
    assert URL is not None
    monkeypatch.setenv("OPTIMISATION_CLE_INTERNE", "cle-integration")
    monkeypatch.setenv("OPTIMISATION_DATABASE_URL", URL)
    base.fermer_pool()
    try:
        d = declinaison("strasbourg", "pondere-dv360-ttd")
        reponse = TestClient(app).post(
            "/v1/plans/zone", headers={"X-Optimisation-Cle": "cle-integration"}, json=d.requete
        )
    finally:
        base.fermer_pool()
    assert reponse.status_code == 200, reponse.text
    commun = reponse.json()["commun"]
    commun["resume"].pop("algo")
    assert ecarts(d.commun, commun) == []
