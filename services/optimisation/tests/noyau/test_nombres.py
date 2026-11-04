"""`somme_gauche`, `math_round`, `arrondi_js` : valeurs attendues relevées sous Node (v22) le 04/11.

`node -e "console.log([0.1,0.2,0.3].reduce((t,x)=>t+x,0), Math.round(0.49999999999999994), ...)"`.
"""

import math

import pytest

from optimisation.noyau.nombres import arrondi_js, math_round, somme_gauche


def test_somme_gauche_suit_le_reduce_js_et_non_sum() -> None:
    # reduce JS : 0.6000000000000001 ; sum() Python ≥ 3.12 : 0.6 (compensée).
    assert somme_gauche([0.1, 0.2, 0.3]) == 0.6000000000000001
    assert sum([0.1, 0.2, 0.3]) == 0.6  # le piège que somme_gauche évite
    # reduce JS : 0 ; sum() compensée : 1.0.
    assert somme_gauche([1e16, 1.0, -1e16]) == 0.0


def test_somme_gauche_vide_et_generateur() -> None:
    assert somme_gauche([]) == 0.0
    assert somme_gauche(x / 10 for x in range(4)) == 0.6000000000000001


@pytest.mark.parametrize(
    ("entree", "attendu"),
    [
        (0.5, 1.0),
        (1.5, 2.0),
        (2.5, 3.0),  # round() Python donnerait 2
        (-2.5, -2.0),  # vers +∞ à la moitié
        (-1.5, -1.0),
        (0.49999999999999994, 0.0),  # floor(v + 0.5) donnerait 1
        (2.4, 2.0),
        (-2.6, -3.0),
        (4503599627370497.0, 4503599627370497.0),  # ≥ 2⁵² : déjà entier
    ],
)
def test_math_round_comme_javascript(entree: float, attendu: float) -> None:
    assert math_round(entree) == attendu


def test_math_round_zero_signe_et_valeurs_speciales() -> None:
    assert math.copysign(1.0, math_round(-0.5)) == -1.0  # Math.round(-0.5) === -0
    assert math.copysign(1.0, math_round(-0.4)) == -1.0
    assert math.copysign(1.0, math_round(0.4)) == 1.0
    assert math.isnan(math_round(math.nan))
    assert math_round(math.inf) == math.inf
    assert math_round(-math.inf) == -math.inf


def test_arrondi_js_garde_la_multiplication_intermediaire() -> None:
    # Math.round(1.005 * 100) / 100 === 1 (1.005 * 100 = 100.49999999999999)
    assert arrondi_js(1.005, 2) == 1.0
    # Math.round(0.0005 * 1000) / 1000 === 0.001
    assert arrondi_js(0.0005, 3) == 0.001
    # Relevés Node : Math.round(x * 1000) / 1000
    assert arrondi_js(2.0005, 3) == 2.001
    assert arrondi_js(999.9995, 3) == 1000.0
    assert arrondi_js(0.1235, 3) == 0.124
    assert arrondi_js(1.0045, 3) == 1.005
    assert arrondi_js(7.0, 0) == 7.0


def test_arrondi_js_refuse_des_decimales_negatives() -> None:
    with pytest.raises(ValueError, match="positif"):
        arrondi_js(1.0, -1)
