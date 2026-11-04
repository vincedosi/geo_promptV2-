"""`puissance_js` = `Math.pow` de Node au bit près ; `min_js`/`max_js` = `Math.min`/`Math.max` (phase 1.4).

Vecteurs produits par Node (`generer-fixtures-historique.ts`) : 729 couples spéciaux (±0, ±∞, NaN, sous-normaux,
|y| > 2⁶⁴…) et 30 000 couples aléatoires, dont 5 000 dans le domaine du recalage (base ∈ [1/3, 3], exposant ∈ [0, 1]).
"""

import math

import pytest

from optimisation.noyau.math_js import max_js, min_js, puissance_js
from tests.parite.historique import contenu, decoder, identique


def test_math_pow_de_node_au_bit_pres() -> None:
    vecteurs = decoder(contenu()["vecteurs"]["pow"])
    assert len(vecteurs) == 27 * 27 + 30_000
    ecarts = [(x, y, attendu) for x, y, attendu in vecteurs if not identique(puissance_js(x, y), attendu)]
    assert ecarts == []


def test_la_puissance_python_n_est_pas_celle_de_node() -> None:
    """Le piège que ce module existe pour éviter : `**` diffère de Node sur une part non nulle des cas."""
    vecteurs = decoder(contenu()["vecteurs"]["pow"])
    domaine = [(x, y, a) for x, y, a in vecteurs if 1 / 3 <= x <= 3 and 0 < y < 1]
    assert any(x**y != a for x, y, a in domaine)


def test_fixture_produite_par_le_v8_porte() -> None:
    assert contenu()["v8"].startswith("11.3."), "V8 a changé : `pow` n'est peut-être plus fdlibm, revoir math_js.py"


@pytest.mark.parametrize(
    ("valeurs", "attendu"),
    [
        ((), math.inf),
        ((1.0, math.nan, 0.0), math.nan),
        ((0.0, -0.0), -0.0),
        ((-0.0, 0.0), -0.0),
        ((3.0, 1.0, 2.0), 1.0),
    ],
)
def test_min_js(valeurs: tuple[float, ...], attendu: float) -> None:
    assert identique(min_js(*valeurs), attendu)


@pytest.mark.parametrize(
    ("valeurs", "attendu"),
    [
        ((), -math.inf),
        ((math.nan, 1.0), math.nan),
        ((-0.0, 0.0), 0.0),
        ((0.0, -0.0), 0.0),
        ((1.0, 3.0, 2.0), 3.0),
    ],
)
def test_max_js(valeurs: tuple[float, ...], attendu: float) -> None:
    assert identique(max_js(*valeurs), attendu)
