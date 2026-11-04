"""Arithmétique alignée sur JavaScript, pour la parité avec le TS (plan § 5.1).

Deux pièges, mesurés avant de coder :

- `sum()` sur des flottants fait une sommation compensée depuis Python 3.12 (Neumaier) : elle ne rend pas
  le même dernier bit que `xs.reduce((t, x) => t + x, 0)`. On somme donc de gauche à droite, à la main.
- `round()` arrondit au pair (`round(0.5) == 0`, `round(2.5) == 2`) ; `Math.round` arrondit vers +∞ à la
  moitié (`Math.round(0.5) == 1`, `Math.round(-0.5) == -0`). `math_round` reproduit `Math.round` bit pour
  bit, `arrondi_js` reproduit l'idiome `Math.round(x * 10 ** n) / 10 ** n` du TS, multiplication
  intermédiaire comprise.
"""

import math
from collections.abc import Iterable

_ENTIER_EXACT = 2.0**52


def somme_gauche(valeurs: Iterable[float]) -> float:
    """Somme de gauche à droite, comme `valeurs.reduce((t, x) => t + x, 0)` en JS.

    Vide → 0.0, comme le `reduce` avec valeur initiale 0.
    """
    total = 0.0
    for valeur in valeurs:
        total = total + valeur
    return total


def math_round(valeur: float) -> float:
    """`Math.round` de JavaScript : entier le plus proche, la moitié vers +∞.

    `math.floor(v + 0.5)` se trompe sur 0.49999999999999994 (la somme s'arrondit à 1.0) ; on compare donc
    la partie fractionnaire, dont le calcul `v - floor(v)` est exact pour |v| < 2⁵². Au-delà, tout
    flottant est déjà entier. NaN et ±∞ passent tels quels. Un résultat nul garde le signe de l'entrée,
    comme en JS (`Math.round(-0.4)` vaut `-0`).
    """
    if math.isnan(valeur) or math.isinf(valeur) or abs(valeur) >= _ENTIER_EXACT:
        return valeur
    plancher = math.floor(valeur)
    resultat = float(plancher + 1) if valeur - plancher >= 0.5 else float(plancher)
    if resultat == 0.0 and math.copysign(1.0, valeur) < 0:
        return -0.0
    return resultat


def arrondi_js(valeur: float, decimales: int) -> float:
    """`Math.round(valeur * 10 ** decimales) / 10 ** decimales`, même multiplication intermédiaire.

    `arrondi_js(1.005, 2)` vaut donc 1.0 et non 1.01 : `1.005 * 100` vaut 100.49999999999999 en
    double, en JS comme en Python. C'est voulu — la parité porte sur ce que fait le TS, pas sur
    l'arrondi décimal exact.
    """
    if decimales < 0:
        raise ValueError("decimales doit être positif ou nul")
    if decimales > 308:
        # 10**309 ne tient pas dans un double : `float()` lèverait OverflowError (relecture B, M8). Aucun appelant
        # n'arrondit à plus de quelques décimales ; refuser en le disant plutôt que d'imiter le NaN du JS.
        raise ValueError("decimales doit être au plus 308")
    facteur = float(10**decimales)  # int ** int est typé Any ; x * 1000 et x * 1000.0 sont le même double
    return math_round(valeur * facteur) / facteur
