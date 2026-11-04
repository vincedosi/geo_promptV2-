"""PARITÉ 2.3 — seuils d'alerte réglables : `suivi(…, seuils)` contre `get_campaign_suivi` (sql/345) sous huit réglages.

Référence : `fixtures/suivi-reglages.json`, produit par `generer_suivi_reglages.sql` (chaque réglage posé dans une
transaction annulée). Mêmes entrées que la parité de phase 1 (démo « élections »), comparaison au texte près.
"""

import json
from datetime import date
from functools import cache
from pathlib import Path
from typing import Any

import pytest

from optimisation.lecture.reglages import parametres_depuis_json
from optimisation.noyau.mesures import SEUILS_DEFAUT, suivi
from tests.parite.demo_sql import json_decimal, sorties
from tests.parite.test_mesures import (
    CLES_SUIVI,
    _attendu_global,
    _multiplicateurs_actifs,
    lignes_cp,
    lignes_jour,
    norm,
    strategie,
)

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "suivi-reglages.json"


@cache
def cas() -> list[dict[str, Any]]:
    contenu: dict[str, Any] = json.loads(FIXTURE.read_text(encoding="utf-8"))
    liste: list[dict[str, Any]] = contenu["cas"]
    return liste


def test_huit_reglages_figes() -> None:
    assert len(cas()) == 8


@pytest.mark.parametrize("rang", range(8))
def test_suivi_sous_reglage_identique_au_sql(rang: int) -> None:
    c = cas()[rang]
    seuils = parametres_depuis_json(json.dumps(c["parametres"])).seuils.du_suivi()
    obtenu = suivi(
        strategie(), lignes_jour(), lignes_cp(), _multiplicateurs_actifs(), _attendu_global(), c["acteurs"], seuils
    )
    attendu = json_decimal(c["sortie"])
    assert date.fromordinal(obtenu["jour_au"]).isoformat() == attendu["as_of"]
    assert {k: norm(obtenu[k]) for k in CLES_SUIVI} == {k: norm(attendu[k]) for k in CLES_SUIVI}


def test_sans_reglage_la_sortie_est_celle_de_la_phase_1() -> None:
    # Le cas 0 (réglage vide) rend exactement la sortie figée AVANT sql/345 (fixture de phase 1, acteurs NULL).
    avant = next(s for s in sorties()["get_campaign_suivi"] if s["acteurs"] is None)
    assert json_decimal(cas()[0]["sortie"]) == json_decimal(avant["sortie"])
    assert parametres_depuis_json("{}").seuils.du_suivi() == SEUILS_DEFAUT


def test_les_reglages_changent_bien_les_alertes() -> None:
    titres = [[a["title"] for a in json.loads(c["sortie"])["alerts"]] for c in cas()]
    assert titres[0] == ["Pacing en retard de 10 points", "161 CP cibles sous 70 % du plan"]
    assert titres[1] == ["52 CP cibles sous 50 % du plan"]
    assert "161 CP cibles sous 95.5 % du plan" in titres[4]
    assert "3.4 % du volume hors de la cible" in titres[4]
