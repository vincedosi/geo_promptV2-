"""PARITÉ 1.1 — plan méthode A : arithmétique `numeric`, `interpolate_on_curve`, `apply_zone_weights_to_strategy`.

Référence : les sorties du SQL de la base locale (`generer_fixtures_sql.py`), comparées en TEXTE (échelle comprise),
tolérance nulle. Les multiplicateurs de la démo sont recalculés sur l'UNIVERS FIGÉ (les 11 435 codes de
`bidding_zone_configs`, pas les 11 415 codes livrés aujourd'hui) et comparés aux valeurs écrites par la fonction SQL.
"""

import json
from decimal import Decimal

import pytest

from optimisation.noyau.numeric_pg import arrondir, diviser, echelle, texte
from optimisation.noyau.pression import (
    ModeAbandonne,
    borner_pression,
    compter_positifs,
    courbe_pression,
    interpoler_sur_courbe,
    multiplicateurs_methode_a,
    variable_de,
)
from tests.parite.adaptation import INDEFINI
from tests.parite.demo_sql import cas_ts, entrees, grille_numeric, json_decimal, meme_nombre


def test_division_numeric_identique_a_postgres() -> None:
    divisions = grille_numeric()["divisions"]
    assert len(divisions) > 500
    ecarts = [
        (a, b, q, texte(diviser(Decimal(a), Decimal(b))))
        for a, b, q in divisions
        if texte(diviser(Decimal(a), Decimal(b))) != q
    ]
    assert ecarts == []


def test_round_numeric_identique_a_postgres() -> None:
    for v, n, attendu in grille_numeric()["arrondis"]:
        assert texte(arrondir(Decimal(v), n)) == attendu, (v, n)


def test_echelle_suit_le_texte() -> None:
    assert echelle(Decimal("10.00")) == 2
    assert echelle(Decimal("3")) == 0
    assert echelle(Decimal("1E+2")) == 0


@pytest.mark.parametrize("rang", range(13))
def test_interpolate_on_curve_identique_a_postgres(rang: int) -> None:
    cas = grille_numeric()["interpolations"][rang]
    courbe = json_decimal(cas["courbe"])
    ecarts = []
    for x, attendu in cas["points"]:
        obtenu = interpoler_sur_courbe(courbe, None if x is None else Decimal(x))
        if (None if obtenu is None else texte(obtenu)) != attendu:
            ecarts.append((x, attendu, obtenu))
    assert ecarts == [], cas["courbe"]


def _multiplicateurs_demo() -> dict[str, Decimal]:
    e = entrees()
    s = e["strategie"]
    poids_in = json_decimal(s["in_zone_weights"])
    assert variable_de(poids_in) == e["variable"]
    return multiplicateurs_methode_a(
        univers=e["univers"],
        zone_definie=s["zone_id"] is not None,
        codes_zone=e["codes_zone"],
        valeurs_indicateur={cp: Decimal(v) for cp, v in e["valeurs_indicateur"]},
        poids_en_zone=poids_in,
        poids_hors_zone=json_decimal(s["out_zone_weights"]),
    )


def test_demo_multiplicateurs_identiques_a_bidding_zone_configs() -> None:
    e = entrees()
    ecrits = {cp: m for cp, pays, m, _part, _actif in e["bidding_zone_configs"] if pays == "FR"}
    calcules = _multiplicateurs_demo()
    assert len(calcules) == len(ecrits) == 11_435
    ecarts = [(cp, ecrits[cp], texte(m)) for cp, m in calcules.items() if texte(m) != ecrits[cp]]
    assert ecarts == []


def test_demo_chiffres_du_document() -> None:
    m = _multiplicateurs_demo()
    assert compter_positifs(list(m.values())) == 1_641
    assert max(m.values()) == Decimal("1.6")
    assert (texte(m["13001"]), texte(m["75011"]), texte(m["29200"])) == ("1.214", "0.848", "1.012")


def _un_seul(
    poids_in: str, poids_out: str = "{}", zone: bool = True, en_zone: bool = True, valeur: str | None = "30"
) -> str:
    r = multiplicateurs_methode_a(
        ["75001"],
        zone,
        ["75001"] if en_zone else [],
        {} if valeur is None else {"75001": Decimal(valeur)},
        json_decimal(poids_in),
        json_decimal(poids_out),
    )
    return texte(r["75001"])


def test_modes_simples() -> None:
    assert _un_seul('{"mode": "uniform", "value": 7.5}') == "5.000"  # LEAST(5, …)
    assert _un_seul('{"mode": "uniform", "value": -2}') == "0.000"  # GREATEST(0, …)
    assert _un_seul('{"mode": "uniform"}') == "1.000"
    assert _un_seul("{}") == "1.000"
    assert _un_seul('{"mode": ""}') == "1.000"
    assert _un_seul('{"mode": "by_cp_csv", "values": {"75001": 1.23456}}') == "1.235"
    assert _un_seul('{"mode": "by_cp_csv", "values": {"75001": 1.23449}}') == "1.234"
    assert _un_seul('{"mode": "by_cp_csv", "values": {}}') == "1.000"
    assert _un_seul('{"mode": "by_insee_variable", "curve": []}', valeur=None) == "1.000"
    assert _un_seul("{}", '{"mode": "exclusion"}', en_zone=False) == "0.000"
    assert _un_seul("{}", '{"mode": "uniform", "value": 0.4}', en_zone=False) == "0.400"
    assert _un_seul("{}", "{}", en_zone=False) == "1.000"
    # Branche nationale : pas de zone, `by_cp_csv` tombe dans `ELSE 1.0`.
    assert _un_seul('{"mode": "by_cp_csv", "values": {"75001": 2}}', zone=False) == "1.000"
    assert _un_seul('{"mode": "uniform", "value": 2}', '{"mode": "exclusion"}', zone=False, en_zone=False) == "2.000"


def test_modes_abandonnes_levent() -> None:
    with pytest.raises(ModeAbandonne):
        _un_seul('{"mode": "by_tier", "values": {}}')
    with pytest.raises(ModeAbandonne):
        _un_seul('{"mode": "by_subzone", "value": 1}')
    with pytest.raises(ModeAbandonne):
        _un_seul("{}", '{"mode": "by_tier"}', en_zone=False)


def test_courbe_de_la_demo_est_celle_du_ts() -> None:
    # Le JSON stocké en base est celui qu'a produit `pressureCurve(1.6, undefined, {10, 60})` (cf. test_courbe).
    courbe = json.loads(entrees()["strategie"]["in_zone_weights"])["curve"]
    assert courbe == [{"x": 20, "y": 0.63}, {"x": 30, "y": 1}, {"x": 45, "y": 1.6}]


# ── Parité TS : `clampPressure` et `pressureCurve` (fixtures `ts-phase1.json.gz`) ──────────────────────────────────


def test_clamp_pressure_identique_au_ts() -> None:
    cas = cas_ts("clampPressure")
    assert len(cas) > 20
    for c in cas:
        (m,) = c["args"]
        assert meme_nombre(borner_pression(m), c["sortie"]), c


def test_pressure_curve_identique_au_ts() -> None:
    cas = cas_ts("pressureCurve")
    assert len(cas) > 1000
    for c in cas:
        m, plancher, domaine = c["args"]
        obtenu = courbe_pression(
            m,
            None if plancher is INDEFINI else plancher,
            None if domaine is INDEFINI else (domaine["min"], domaine["max"]),
        )
        attendu = c["sortie"]
        assert len(obtenu) == len(attendu)
        for p, a in zip(obtenu, attendu, strict=True):
            assert meme_nombre(p.x, a["x"]) and meme_nombre(p.y, a["y"]), c
