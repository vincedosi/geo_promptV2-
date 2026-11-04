"""PART DU PLAN et ATTENDU À DATE — port à l'identique du SQL (phase 1.2), en `numeric` Postgres (`numeric_pg`).

- part du plan : le CTE `plan` de `refresh_campaign_rollups` (sql/306, A8). Un plan qui porte sa part prévue (au moins
  une ligne non NULL) la donne telle quelle ; sinon `m ÷ Σ m` sur les lignes ACTIVES. `in_target` : `m > 0` en mode
  strict (`exclusion`), `m > 1` sinon ;
- attendu à date : `get_campaign_expected` (sql/280). Fraction du temps écoulé arrondie au dixième de pourcent, puis
  `kpi_target × t` (objectif « maximize_impressions ») ou `budget × t ÷ CPM × 1 000`.

Les dates n'entrent pas dans le noyau (pas de `datetime` ici) : l'appelant passe des numéros de jour
(`date.toordinal()`), dont seules les différences comptent — `v_as_of - s.start_date` : différence de jours en SQL.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal, localcontext

from optimisation.noyau.numeric_pg import EXACT, arrondir, diviser, diviser_ou_nul, plus_grand, plus_petit, somme

MODE_STRICT = "exclusion"
OBJECTIF_IMPRESSIONS = "maximize_impressions"


@dataclass(frozen=True)
class LignePlan:
    """Une ligne de `bidding_zone_configs` : code, `bid_multiplier`, `part_prevue`, `is_active`."""

    code_postal: str
    multiplicateur: Decimal
    part_prevue: Decimal | None
    actif: bool = True


@dataclass(frozen=True)
class PartDuPlan:
    code_postal: str
    part: Decimal | None
    en_cible: bool


def parts_du_plan(lignes: Sequence[LignePlan], mode_hors_zone: str | None) -> list[PartDuPlan]:
    """Le CTE `plan` : une sortie par ligne ACTIVE, dans l'ordre reçu."""
    actives = [ligne for ligne in lignes if ligne.actif]
    porte_part_prevue = any(ligne.part_prevue is not None for ligne in actives)
    total = somme(ligne.multiplicateur for ligne in actives)
    sortie = []
    for ligne in actives:
        part = ligne.part_prevue if porte_part_prevue else diviser_ou_nul(ligne.multiplicateur, total)
        seuil = Decimal(0) if mode_hors_zone == MODE_STRICT else Decimal(1)
        sortie.append(PartDuPlan(ligne.code_postal, part, ligne.multiplicateur > seuil))
    return sortie


def par_code(parts: Sequence[PartDuPlan]) -> dict[str, PartDuPlan]:
    """Ce que le rollup garde par code : `MAX(planned_share)` (NULL ignorés) et `BOOL_OR(in_target)`."""
    sortie: dict[str, PartDuPlan] = {}
    for p in parts:
        avant = sortie.get(p.code_postal)
        if avant is None:
            sortie[p.code_postal] = p
            continue
        # `numeric_larger` rend le SECOND argument à égalité : la ligne la plus récente l'emporte.
        part = avant.part if p.part is None or (avant.part is not None and avant.part > p.part) else p.part
        sortie[p.code_postal] = PartDuPlan(p.code_postal, part, avant.en_cible or p.en_cible)
    return sortie


@dataclass(frozen=True)
class StrategiePrevue:
    """Les colonnes de `bidding_strategies` que lit `get_campaign_expected` (dates en numéros de jour)."""

    total_budget: Decimal | None
    forecast_cpm: Decimal | None
    jour_debut: int | None
    jour_fin: int | None
    kpi_target: Decimal | None
    objective_code: str | None


def fraction_du_temps(jour_debut: int, jour_fin: int, jour_au: int) -> Decimal:
    """`ROUND(LEAST(1, GREATEST(0, (au − début + 1)::numeric ÷ (fin − début + 1))) × 100, 1)` (sans le ÷ 100)."""
    with localcontext(EXACT):
        brut = diviser(Decimal(jour_au - jour_debut + 1), Decimal(jour_fin - jour_debut + 1))
        borne = plus_petit(Decimal(1), plus_grand(Decimal(0), brut))
        if borne is None:  # impossible : arguments non NULL
            raise ValueError("borne NULL")
        return arrondir(borne * 100, 1)


def attendu_a_date(strategie: StrategiePrevue | None, jour_au: int | None) -> Decimal | None:
    """`get_campaign_expected` : le volume attendu au dernier jour livré (`jour_au`), ou None."""
    s = strategie
    if s is None:
        return None
    if jour_au is None or s.jour_debut is None or s.jour_fin is None or s.jour_fin < s.jour_debut:
        return None
    temps = diviser(fraction_du_temps(s.jour_debut, s.jour_fin, jour_au), Decimal(100))
    with localcontext(EXACT):
        if s.kpi_target is not None and s.kpi_target > 0 and s.objective_code == OBJECTIF_IMPRESSIONS:
            return s.kpi_target * temps
        if s.total_budget is not None and s.forecast_cpm is not None and s.forecast_cpm > 0:
            return diviser(s.total_budget * temps, s.forecast_cpm) * 1000
    return None
