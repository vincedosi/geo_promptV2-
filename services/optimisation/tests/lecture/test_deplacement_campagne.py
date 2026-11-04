"""INTÉGRATION (relecture de la phase 2, I1) : une campagne DÉPLACÉE vers un autre espace garde son réglage, et le SQL
et Python le lisent IDENTIQUEMENT (sql/348 : le réglage suit la campagne, lu par `campagne_id` des deux côtés).

Scénario de la relecture, rejoué dans UNE transaction ANNULÉE sur la base locale :
  1. la démo « élections » est réglée `cp_sous_plan_pct = 50` dans l'espace A ;
  2. l'administrateur la passe à l'espace B (`update dsp_campaigns set organization_id`, comme
     `PATCH /api/admin/campaigns/[id]`) ;
  3. le cockpit SQL (`get_campaign_suivi`) ET Python (`lire_reglages` + `noyau.mesures.suivi`) annoncent
     « 52 CP cibles sous 50 % du plan » ; Python refuse l'espace A (404) ; le réglage porte `workspace_id = B` ;
  4. sous la RLS, un compte de B lit la ligne ; un compte de A la lit tant que A reste lié à la campagne
     (`campaign_organizations`, que le PATCH ne touche pas), 0 ligne une fois délié ;
  5. une campagne passée à `organization_id = null` ne fait pas échouer le déplacement (cas documenté de sql/348).

Connexion ADMINISTRATEUR locale (`postgres`, mot de passe par défaut du stack Supabase local — pas un secret) : il faut
écrire `dsp_campaigns`, ce que `optimisation_service` ne peut pas, et SQL comme Python doivent voir la même transaction
non validée. `postgres` n'a pas l'option SET sur `optimisation_service` : la lecture Python passe donc par la même
connexion (BYPASSRLS comme le service ; même code, même requête). Jamais un autre hôte que 127.0.0.1.
"""

import json
import os
from collections.abc import Iterator

import psycopg
import pytest

from optimisation.lecture.mesures import (
    lire_plan,
    lire_rollup_cp,
    lire_rollup_jour,
    lire_strategie_suivi,
)
from optimisation.lecture.reglages import CampagneHorsEspace, lire_reglages
from optimisation.noyau.mesures import suivi
from optimisation.noyau.numeric_pg import texte
from optimisation.noyau.prevu import attendu_a_date
from tests.lecture.test_base_locale import pytestmark  # noqa: F401  (même garde : base locale joignable)

URL_ADMIN = os.environ.get("OPTIMISATION_TEST_URL_ADMIN", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
CAMPAGNE = "dccc0000-0000-4000-8000-000000000002"
ESPACE_A = "00000000-0000-0000-0000-000000000001"
ESPACE_B = "83cae295-9239-44b5-bb12-7a8b23448b01"
ALERTE_REGLEE = "52 CP cibles sous 50 % du plan"


@pytest.fixture
def admin() -> Iterator[psycopg.Connection[tuple[object, ...]]]:
    assert "@127.0.0.1:54322/" in URL_ADMIN
    try:
        c = psycopg.connect(URL_ADMIN, connect_timeout=5)
    except psycopg.Error:
        pytest.skip("connexion administrateur locale indisponible")
    with c:
        with c.cursor() as cur:
            cur.execute("select organization_id::text from public.dsp_campaigns where id = %s", (CAMPAGNE,))
            assert cur.fetchone() == (ESPACE_A,), "la démo n'est plus dans l'espace A"
            cur.execute("select count(*) from public.optimisation_reglages where campagne_id = %s", (CAMPAGNE,))
            assert cur.fetchone() == (0,), "réglage déjà présent sur la démo"
        yield c
        c.rollback()


def _alertes_sql(cur: psycopg.Cursor[tuple[object, ...]]) -> list[str]:
    cur.execute("select public.get_campaign_suivi(%s)::text", (CAMPAGNE,))
    ligne = cur.fetchone()
    assert ligne is not None
    return [str(a["title"]) for a in json.loads(str(ligne[0]))["alerts"]]


def _alertes_python(conn: psycopg.Connection[tuple[object, ...]], espace: str) -> list[str]:
    reglages = lire_reglages(conn, CAMPAGNE, espace)
    lu = lire_strategie_suivi(conn, CAMPAGNE)
    assert lu is not None
    id_strategie, strategie = lu
    jours = lire_rollup_jour(conn, CAMPAGNE)
    plan = [ligne.multiplicateur for ligne in lire_plan(conn, id_strategie) if ligne.actif]
    attendu = attendu_a_date(strategie.prevue, max(j.jour for j in jours))
    r = suivi(
        strategie, jours, lire_rollup_cp(conn, CAMPAGNE), plan, attendu, seuils=reglages.parametres.seuils.du_suivi()
    )
    return [str(a["title"]) for a in r["alerts"]]


def _lignes_visibles(cur: psycopg.Cursor[tuple[object, ...]], espace: str) -> int:
    """Lignes de réglage lues sous la RLS par un CLIENT de `espace`. Revendications du crochet
    `custom_access_token_hook` (`workspace_id`, `user_role`), lues d'abord par `get_user_org()` / `get_user_role()`."""
    claims = json.dumps(
        {
            "sub": "00000000-0000-4000-8000-0000000000c1",
            "role": "authenticated",
            "workspace_id": espace,
            "user_role": "client",
        }
    )
    cur.execute("select set_config('request.jwt.claims', %s, true)", (claims,))
    cur.execute("set local role authenticated")
    cur.execute("select count(*) from public.optimisation_reglages where campagne_id = %s", (CAMPAGNE,))
    n = cur.fetchone()
    cur.execute("reset role")
    assert n is not None
    return int(str(n[0]))


def test_campagne_deplacee_meme_reglage_sql_et_python(admin: psycopg.Connection[tuple[object, ...]]) -> None:
    with admin.cursor() as cur:
        cur.execute(
            "insert into public.optimisation_reglages (campagne_id, workspace_id, parametres) values (%s, %s, %s)",
            (CAMPAGNE, ESPACE_A, '{"seuils": {"cp_sous_plan_pct": 50}}'),
        )
        assert ALERTE_REGLEE in _alertes_sql(cur)
        # Le déplacement, comme le PATCH admin.
        cur.execute("update public.dsp_campaigns set organization_id = %s where id = %s", (ESPACE_B, CAMPAGNE))
        cur.execute("select workspace_id::text from public.optimisation_reglages where campagne_id = %s", (CAMPAGNE,))
        assert cur.fetchone() == (ESPACE_B,), "le déclencheur de sql/348 n'a pas suivi la campagne"
        sql = _alertes_sql(cur)
    python = _alertes_python(admin, ESPACE_B)
    assert ALERTE_REGLEE in sql
    assert ALERTE_REGLEE in python
    assert sorted(a for a in sql if "CP cibles" in a) == sorted(a for a in python if "CP cibles" in a)
    assert texte(lire_reglages(admin, CAMPAGNE, ESPACE_B).parametres.seuils.cp_sous_plan_pct) == "50"
    with pytest.raises(CampagneHorsEspace):
        lire_reglages(admin, CAMPAGNE, ESPACE_A)
    with admin.cursor() as cur:
        assert _lignes_visibles(cur, ESPACE_B) == 1
        # L'ancien espace reste LIÉ à la campagne par `campaign_organizations` (le PATCH admin ne touche pas le pivot,
        # où chaque campagne porte son propriétaire) : il lit le réglage au même titre que la campagne elle-même
        # (`dsp_campaigns_select`). Délié, il ne lit plus rien — c'est `workspace_id` suivi qui le garantit.
        assert _lignes_visibles(cur, ESPACE_A) == 1
        cur.execute(
            "delete from public.campaign_organizations where campaign_id = %s and organization_id = %s",
            (CAMPAGNE, ESPACE_A),
        )
        assert _lignes_visibles(cur, ESPACE_A) == 0


def test_campagne_sans_espace_le_deplacement_reussit(admin: psycopg.Connection[tuple[object, ...]]) -> None:
    with admin.cursor() as cur:
        cur.execute(
            "insert into public.optimisation_reglages (campagne_id, workspace_id, parametres) values (%s, %s, %s)",
            (CAMPAGNE, ESPACE_A, '{"seuils": {"cp_sous_plan_pct": 50}}'),
        )
        cur.execute("update public.dsp_campaigns set organization_id = null where id = %s", (CAMPAGNE,))
        cur.execute("select workspace_id::text from public.optimisation_reglages where campagne_id = %s", (CAMPAGNE,))
        assert cur.fetchone() == (ESPACE_A,)  # dernier propriétaire gardé (colonne non nulle)
        assert ALERTE_REGLEE in _alertes_sql(cur)  # le SQL lit toujours par campagne_id
    for espace in (ESPACE_A, ESPACE_B):
        with pytest.raises(CampagneHorsEspace):
            lire_reglages(admin, CAMPAGNE, espace)
