"""Plan initial, MÉTHODE A (donnée INSEE + pression) — port à l'identique, phase 1.1.

Deux sources, deux arithmétiques :

- la COURBE vient du TS (`components/campaign/wizard/steps/types.ts`, `clampPressure` et `pressureCurve`) : flottants
  JS, `Math.round` → `arrondi_js` ;
- les MULTIPLICATEURS viennent du SQL (`sql/106_indicator_cp_values.sql`, `apply_zone_weights_to_strategy`, et
  `interpolate_on_curve`) : `numeric` Postgres → `Decimal` (`numeric_pg`), y compris l'échelle de la division
  d'interpolation, les bornes `GREATEST(0, LEAST(5, …))` et l'écriture dans `bidding_zone_configs.bid_multiplier`
  (`numeric(6,3)`, moitié loin de zéro).

L'UNIVERS des codes est une ENTRÉE : le SQL le lit dans `dsp_campaign_data` (tous les codes déjà livrés, toutes
campagnes confondues) au moment de l'appel. La parité porte donc sur l'univers figé de la démo (11 435 codes), pas sur
celui d'aujourd'hui ; la correction « référentiel complet » est de la phase 2.

Modes non portés : `by_tier` (il appelle la fonction SQL `infer_tier`) et `by_subzone` (il relit
`bidding_strategy_subzones`) — `ModeNonPorte` est levé plutôt que de rendre 1,0 en silence.
"""

import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal, localcontext
from typing import Any

from optimisation.noyau.nombres import arrondi_js
from optimisation.noyau.numeric_pg import EXACT, arrondir, diviser, plus_grand, plus_petit

# `PRESSURE_MIN` / `PRESSURE_MAX` (types.ts). Seuils de phase 1, laissés en dur (leur réglage est de la phase 2).
PRESSION_MIN = 1.0
PRESSION_MAX = 3.0
# Domaine par défaut de `pressureCurve` : les bornes du registre pour l'abstention.
DOMAINE_DEFAUT = (10.0, 60.0)
# `GREATEST(0, LEAST(5, …))` de `apply_zone_weights_to_strategy`, puis `numeric(6,3)`.
MULTIPLICATEUR_MIN = Decimal(0)
MULTIPLICATEUR_MAX = Decimal(5)
DECIMALES_MULTIPLICATEUR = 3
VARIABLE_DEFAUT = "abstention_pres_2022"

_UN = Decimal("1.0")  # le littéral `1.0` du SQL (échelle 1)


class ModeNonPorte(Exception):
    """Mode de pondération dont le calcul dépend d'une table ou d'une fonction SQL non portée."""


@dataclass(frozen=True)
class PointCourbe:
    x: float
    y: float


def borner_pression(m: float) -> float:
    """`clampPressure` : non fini → 1 ; sinon arrondi au centième, borné à [1, 3]."""
    if not math.isfinite(m):
        return PRESSION_MIN
    return min(PRESSION_MAX, max(PRESSION_MIN, arrondi_js(m, 2)))


def courbe_pression(
    m: float, plancher: float | None = None, domaine: tuple[float, float] | None = None
) -> list[PointCourbe]:
    """`pressureCurve` : (min+0,2Δ ; 1/M), (min+0,4Δ ; 1), (min+0,7Δ ; M), y relevé au plancher s'il est donné."""
    p = borner_pression(m)
    bas = arrondi_js((1 / p) * 100, 0) / 100

    def f(y: float) -> float:
        return max(plancher, y) if plancher is not None else y

    mini, maxi = domaine if domaine is not None else DOMAINE_DEFAUT
    etendue = maxi - mini

    def x(frac: float) -> float:
        return arrondi_js(mini + frac * etendue, 2)

    return [PointCourbe(x(0.2), f(bas)), PointCourbe(x(0.4), f(1.0)), PointCourbe(x(0.7), f(p))]


def _numeric_json(v: Any) -> Decimal | None:
    """`(jsonb ->> 'k')::numeric` sur une valeur JSON lue en `Decimal` (`parse_float=Decimal`) ; NULL si absente."""
    if v is None:
        return None
    if isinstance(v, bool):
        raise ValueError("booléen JSON converti en numeric")
    if isinstance(v, int):
        return Decimal(v)
    if isinstance(v, Decimal):
        return v
    if isinstance(v, str):
        return Decimal(v.strip())
    raise ValueError(f"valeur JSON non numérique : {v!r}")


def interpoler_sur_courbe(courbe: Any, x: Decimal | None) -> Decimal | None:
    """`interpolate_on_curve(p_curve jsonb, p_x numeric)` : linéaire par morceaux, plat hors des extrémités.

    `courbe` est la valeur JSON lue avec `parse_float=Decimal` (liste de `{"x", "y"}`), ou None. Rend None là où la
    fonction SQL rend NULL (un `y` absent) ; une comparaison à un `x` absent est fausse, comme en plpgsql.
    """
    if courbe is None or not isinstance(courbe, list) or len(courbe) == 0 or x is None:
        return _UN
    n = len(courbe)

    def lire(i: int, cle: str) -> Decimal | None:
        point = courbe[i]
        return _numeric_json(point.get(cle)) if isinstance(point, dict) else None

    if n == 1:
        return lire(0, "y")
    premier_x = lire(0, "x")
    if premier_x is not None and x <= premier_x:
        return lire(0, "y")
    dernier_x = lire(n - 1, "x")
    if dernier_x is not None and x >= dernier_x:
        return lire(n - 1, "y")
    for i in range(n - 1):
        x1, y1 = lire(i, "x"), lire(i, "y")
        x2, y2 = lire(i + 1, "x"), lire(i + 1, "y")
        if x1 is not None and x2 is not None and x >= x1 and x <= x2:
            if x2 == x1:
                return y1
            if y1 is None or y2 is None:
                return None
            with localcontext(EXACT):
                t = diviser(x - x1, x2 - x1)
                return y1 + t * (y2 - y1)
    return _UN


def _coalesce_un(v: Decimal | None) -> Decimal:
    """`COALESCE(…, 1.0)`."""
    return _UN if v is None else v


def _borner(m: Decimal) -> Decimal:
    borne = plus_grand(MULTIPLICATEUR_MIN, plus_petit(MULTIPLICATEUR_MAX, m))
    if borne is None:  # impossible : deux arguments non NULL
        raise ValueError("borne NULL")
    return arrondir(borne, DECIMALES_MULTIPLICATEUR)


def _valeur_mode(poids: Mapping[str, Any], cle: str, code: str | None = None) -> Decimal:
    """`COALESCE((p->>'value')::numeric, 1.0)`, ou `(p->'values'->>code)` avec un code."""
    if code is None:
        return _coalesce_un(_numeric_json(poids.get(cle)))
    valeurs = poids.get(cle)
    return _coalesce_un(_numeric_json(valeurs.get(code)) if isinstance(valeurs, dict) else None)


def multiplicateurs_methode_a(
    univers: Iterable[str],
    zone_definie: bool,
    codes_zone: Iterable[str],
    valeurs_indicateur: Mapping[str, Decimal],
    poids_en_zone: Mapping[str, Any],
    poids_hors_zone: Mapping[str, Any],
) -> dict[str, Decimal]:
    """Les `bid_multiplier` qu'écrit `apply_zone_weights_to_strategy`, code par code, dans l'ordre de l'univers.

    - `univers` : les codes postaux distincts (le SQL : `SELECT DISTINCT postal_code FROM dsp_campaign_data`) ;
    - `zone_definie` : la stratégie porte un `zone_id` (branche zone) ou non (branche nationale) ;
    - `codes_zone` : les codes `cp` de la zone (`custom_geo_zone_codes`), ignorés en branche nationale ;
    - `valeurs_indicateur` : `indicator_cp_values.value` de la variable de `poids_en_zone` (défaut abstention) ;
    - `poids_en_zone` / `poids_hors_zone` : les JSON `in_zone_weights` / `out_zone_weights`, lus en `Decimal`.
    """
    # `COALESCE(p->>'mode', 'uniform')` : seul l'ABSENT (ou JSON null) vaut « uniform » ; "" tombe dans `ELSE 1.0`.
    mode_in = poids_en_zone.get("mode")
    mode_out = poids_hors_zone.get("mode")
    mode_in = "uniform" if mode_in is None else mode_in
    mode_out = "uniform" if mode_out is None else mode_out
    if not isinstance(mode_in, str) or not isinstance(mode_out, str):
        raise ValueError("mode de pondération non textuel")
    courbe = poids_en_zone.get("curve")
    zone = frozenset(codes_zone) if zone_definie else frozenset()
    sortie: dict[str, Decimal] = {}
    for code in dict.fromkeys(univers):
        valeur = valeurs_indicateur.get(code)
        en_zone = (not zone_definie) or code in zone
        m: Decimal
        if en_zone:
            if mode_in == "uniform":
                m = _valeur_mode(poids_en_zone, "value")
            elif mode_in in ("by_tier", "by_subzone") and (zone_definie or mode_in == "by_tier"):
                raise ModeNonPorte(f"mode {mode_in} non porté (dépend d'une table ou fonction SQL)")
            elif mode_in == "by_cp_csv" and zone_definie:
                m = _valeur_mode(poids_en_zone, "values", code)
            elif mode_in == "by_insee_variable":
                m = _coalesce_un(interpoler_sur_courbe(courbe, valeur))
            else:
                # Branche nationale : `by_subzone` / `by_cp_csv` tombent dans `ELSE 1.0` ; idem pour un mode inconnu.
                m = _UN
        elif mode_out == "uniform":
            m = _valeur_mode(poids_hors_zone, "value")
        elif mode_out == "exclusion":
            m = Decimal("0.0")
        elif mode_out == "by_tier":
            raise ModeNonPorte("mode by_tier non porté (dépend de la fonction SQL infer_tier)")
        else:
            m = _UN
        sortie[code] = _borner(m)
    return sortie


def variable_de(poids_en_zone: Mapping[str, Any]) -> str:
    """`COALESCE(p_in_weights->>'variable_code', 'abstention_pres_2022')`."""
    v = poids_en_zone.get("variable_code")
    return v if isinstance(v, str) else VARIABLE_DEFAUT


def compter_positifs(multiplicateurs: Sequence[Decimal]) -> int:
    """Nombre de multiplicateurs strictement positifs (les CP effectivement achetés en mode strict)."""
    return len([m for m in multiplicateurs if m > 0])
