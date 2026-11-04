"""Arithmétique `numeric` de PostgreSQL, pour la parité avec les fonctions SQL (plan § 11, phase 1).

Les calculs portés depuis le SQL (méthode A, part du plan, attendu à date, score, écarts, alertes) se font en
`numeric`, pas en flottant. On les rejoue en `Decimal` avec les règles de Postgres 17 :

- addition, soustraction, multiplication : EXACTES ; l'échelle du résultat (`dscale`) est celle de `Decimal` —
  max des échelles pour ± , somme des échelles pour × — comme `add_var` / `mul_var`. Le contexte `EXACT` piège
  `Inexact` : un calcul qui arrondirait en silence lève au lieu de diverger ;
- division : JAMAIS l'opérateur `/` de `Decimal` (son échelle n'est pas celle de Postgres). `diviser` reproduit
  `numeric_div` : échelle choisie par `select_div_scale` (16 chiffres significatifs au moins, en base 10 000), quotient
  exact arrondi à cette échelle, la moitié loin de zéro ;
- `round(x, n)` et la conversion vers `numeric(p, s)` : moitié loin de zéro, échelle n (`round_var`, `apply_typmod`) ;
- `GREATEST` / `LEAST` : ignorent les NULL, rendent le PREMIER extrême à égalité.

L'échelle compte : elle se voit dans le texte rendu (`10.00`, `4920000.0000000000000000000000`) et elle entre dans le
choix de l'échelle de la division suivante.
"""

from collections.abc import Iterable
from decimal import (
    ROUND_HALF_UP,
    Context,
    Decimal,
    DivisionByZero,
    Inexact,
    InvalidOperation,
    Overflow,
    localcontext,
)
from fractions import Fraction

# NUMERIC_MIN_SIG_DIGITS, DEC_DIGITS, NUMERIC_MIN_DISPLAY_SCALE, NUMERIC_MAX_DISPLAY_SCALE (numeric.c).
_CHIFFRES_SIGNIFICATIFS_MIN = 16
_CHIFFRES_PAR_MOT = 4
_ECHELLE_MIN = 0
_ECHELLE_MAX = 1000

# Le contexte des calculs `numeric` (`with localcontext(EXACT):`) : assez de chiffres pour que toute opération exacte
# du portage le reste, et `Inexact` piégé pour le garantir — une opération qui arrondirait lève au lieu de diverger.
EXACT = Context(prec=4000, rounding=ROUND_HALF_UP, traps=[InvalidOperation, DivisionByZero, Overflow, Inexact])
# Le seul arrondi voulu (`round`, typmod) : même précision, `Inexact` non piégé.
_ARRONDI = Context(prec=4000, rounding=ROUND_HALF_UP, traps=[InvalidOperation, DivisionByZero, Overflow])


def echelle(x: Decimal) -> int:
    """Le `dscale` Postgres d'une valeur : le nombre de décimales écrites (`1.50` → 2, `3` → 0)."""
    exposant = x.as_tuple().exponent
    if not isinstance(exposant, int):
        raise ValueError(f"valeur numeric non finie : {x}")
    return max(0, -exposant)


def _poids_et_premier_mot(x: Decimal) -> tuple[int, int]:
    """Poids et premier « chiffre » en base 10 000 de |x| (`select_div_scale`) ; (0, 0) pour zéro."""
    if x.is_zero():
        return 0, 0
    absolu = abs(x)
    poids = absolu.adjusted() // _CHIFFRES_PAR_MOT
    with localcontext(EXACT):
        premier = int(absolu.scaleb(-_CHIFFRES_PAR_MOT * poids))
    return poids, premier


def echelle_division(a: Decimal, b: Decimal) -> int:
    """`select_div_scale` : l'échelle du quotient `a / b` en Postgres."""
    poids_a, premier_a = _poids_et_premier_mot(a)
    poids_b, premier_b = _poids_et_premier_mot(b)
    poids_q = poids_a - poids_b
    if premier_a <= premier_b:
        poids_q -= 1
    resultat = _CHIFFRES_SIGNIFICATIFS_MIN - poids_q * _CHIFFRES_PAR_MOT
    resultat = max(resultat, echelle(a), echelle(b), _ECHELLE_MIN)
    return min(resultat, _ECHELLE_MAX)


def _depuis_entier_echelle(n: int, ech: int) -> Decimal:
    with localcontext(EXACT):
        return Decimal(n).scaleb(-ech)


def diviser(a: Decimal, b: Decimal) -> Decimal:
    """`a / b` en `numeric` Postgres. Lève `ZeroDivisionError` sur b = 0 (le SQL porté passe par `NULLIF`)."""
    if b.is_zero():
        raise ZeroDivisionError("division numeric par zéro")
    ech = echelle_division(a, b)
    q = Fraction(a) / Fraction(b) * (10**ech)
    entier, reste = divmod(abs(q.numerator), q.denominator)
    if 2 * reste >= q.denominator:
        entier += 1
    return _depuis_entier_echelle(-entier if q < 0 else entier, ech)


def diviser_ou_nul(a: Decimal | None, b: Decimal | None) -> Decimal | None:
    """`a / NULLIF(b, 0)` : NULL si l'un est NULL ou si b vaut 0."""
    if a is None or b is None or b.is_zero():
        return None
    return diviser(a, b)


def arrondir(x: Decimal, decimales: int = 0) -> Decimal:
    """`round(x, n)` et la conversion vers `numeric(p, n)` : moitié loin de zéro, échelle exactement n (n ≥ 0)."""
    if decimales < 0:
        raise ValueError("decimales doit être positif ou nul")
    return x.quantize(Decimal(1).scaleb(-decimales, context=_ARRONDI), rounding=ROUND_HALF_UP, context=_ARRONDI)


def plus_grand(*valeurs: Decimal | None) -> Decimal | None:
    """`GREATEST(…)` : NULL ignorés, le premier maximum gardé à égalité ; NULL si tous le sont."""
    choisi: Decimal | None = None
    for v in valeurs:
        if v is not None and (choisi is None or v > choisi):
            choisi = v
    return choisi


def plus_petit(*valeurs: Decimal | None) -> Decimal | None:
    """`LEAST(…)` : NULL ignorés, le premier minimum gardé à égalité ; NULL si tous le sont."""
    choisi: Decimal | None = None
    for v in valeurs:
        if v is not None and (choisi is None or v < choisi):
            choisi = v
    return choisi


def texte(x: Decimal) -> str:
    """Le texte de `numeric_out` : jamais de notation scientifique, toutes les décimales de l'échelle."""
    return format(x, "f")


def somme(valeurs: Iterable[Decimal | None]) -> Decimal | None:
    """`SUM(numeric)` : exacte, NULL ignorés, NULL si aucune valeur non NULL. Échelle = max des échelles."""
    total: Decimal | None = None
    with localcontext(EXACT):
        for v in valeurs:
            if v is not None:
                total = v if total is None else total + v
    return total
