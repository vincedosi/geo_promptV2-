"""MESURES de suivi — port à l'identique du SQL (phase 1.3), en `numeric` Postgres (`numeric_pg`).

- `alignement_geo` : `calculer_alignement_geo` (sql/209) — score `100 − manque − poids × trop`, à la tolérance ;
- `alignement_par_maille` : `alignement_par_maille` (écarts par région, département ou CP, tri par volume déplacé) ;
- `suivi` : la partie DÉCISIONNELLE de `get_campaign_suivi` (sql/113) — rythme, CPM, pression, objectif, CP sous ou
  au-dessus de l'objectif, et les quatre ALERTES. Les tableaux d'affichage (`level1`, `depts`, `daily`, `medias`)
  restent servis par la fonction SQL et ne sont pas portés.

Les sorties ont la forme du `jsonb` SQL (mêmes clés) ; les `numeric` y sont des `Decimal` à la même échelle. Les seuils
(0,85 / 0,70 / 1,15 / 1,30 / × 1,25 / 70 % / 5 % / 90 % / 110 %) restent écrits en dur, comme en SQL : leur passage en
réglages par campagne est la phase 2.

Les entrées sont les lignes de `campaign_cp_rollup` et `campaign_daily_rollup` (déjà agrégées par le SQL de
`refresh_campaign_rollups`, qui reste en base) ; les dates y sont des numéros de jour (pas de `datetime` ici).
"""

from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal, localcontext
from typing import Any

from optimisation.noyau.numeric_pg import (
    EXACT,
    arrondir,
    diviser,
    diviser_ou_nul,
    plus_grand,
    somme,
    texte,
)
from optimisation.noyau.prevu import MODE_STRICT, OBJECTIF_IMPRESSIONS, StrategiePrevue, fraction_du_temps

# Seuils de `get_campaign_suivi`, en dur (phase 2 : réglages).
RYTHME_RETARD = Decimal("0.85")
RYTHME_RETARD_GRAVE = Decimal("0.70")
RYTHME_AVANCE = Decimal("1.15")
RYTHME_AVANCE_GRAVE = Decimal("1.30")
CPM_DEPASSEMENT = Decimal("1.25")
CP_SOUS_PLAN_PCT = Decimal(70)
FUITE_PCT = Decimal(5)
OBJECTIF_SOUS_PCT = Decimal(90)
OBJECTIF_SUR_PCT = Decimal(110)

MAILLES = ("region", "departement", "cp")
_CENT = Decimal(100)
_ZERO = Decimal(0)
_UN = Decimal(1)

Json = dict[str, Any]


@dataclass(frozen=True)
class LigneCp:
    """Une ligne de `campaign_cp_rollup` (un code × un acteur)."""

    code_postal: str
    acteur: str
    dept: str | None
    impressions: int
    depense: Decimal
    imps_7j: int
    imps_7j_precedents: int
    en_cible: bool
    part_plan: Decimal | None


@dataclass(frozen=True)
class LigneJour:
    """Une ligne de `campaign_daily_rollup` (un jour × un média × un acteur)."""

    jour: int
    media: str
    acteur: str
    impressions: int
    depense: Decimal


@dataclass(frozen=True)
class ParametresCampagne:
    """`dsp_campaigns.tolerance_pct` et `overpressure_weight`."""

    tolerance_pct: Decimal
    poids_surpression: Decimal


@dataclass(frozen=True)
class Referentiel:
    """`ref_codes_postaux` (code → département), `ref_departements` (→ nom, région), `ref_regions` (→ nom)."""

    dept_du_cp: Mapping[str, str | None]
    departements: Mapping[str, tuple[str | None, str | None]]
    regions: Mapping[str, str]


def _max_numeric(valeurs: Iterable[Decimal | None]) -> Decimal | None:
    choisi: Decimal | None = None
    for v in valeurs:
        if v is not None and (choisi is None or v >= choisi):
            choisi = v
    return choisi


@dataclass
class _Cp:
    reel: Decimal
    reel_prec: Decimal
    part: Decimal | None
    depense: Decimal | None


def _par_code(lignes: Sequence[LigneCp]) -> dict[str, _Cp]:
    """Le CTE `cp` : sommes par code sur les acteurs, `max(planned_share)`."""
    groupes: dict[str, list[LigneCp]] = {}
    for ligne in lignes:
        groupes.setdefault(ligne.code_postal, []).append(ligne)
    sortie = {}
    for code, ls in groupes.items():
        sortie[code] = _Cp(
            reel=somme(Decimal(x.impressions) for x in ls) or _ZERO,
            reel_prec=somme(Decimal(x.imps_7j_precedents) for x in ls) or _ZERO,
            part=_max_numeric(x.part_plan for x in ls),
            depense=somme(x.depense for x in ls),
        )
    return sortie


def _mul(a: Decimal | None, b: Decimal | None) -> Decimal | None:
    if a is None or b is None:
        return None
    with localcontext(EXACT):
        return a * b


def _arr(x: Decimal | None, n: int = 0) -> Decimal | None:
    return None if x is None else arrondir(x, n)


def _pct(a: Decimal | None, b: Decimal | None) -> Decimal | None:
    """`a / NULLIF(b, 0) * 100`."""
    return _mul(diviser_ou_nul(a, b), _CENT)


def alignement_geo(
    lignes: Sequence[LigneCp],
    campagne: ParametresCampagne | None,
    tolerance: Decimal | None = None,
    poids: Decimal | None = None,
) -> Json:
    """`calculer_alignement_geo(campagne, p_tolerance, p_poids)`."""
    if campagne is None:
        return {"error": "campagne_introuvable", "calculable": False}
    tol = diviser(tolerance if tolerance is not None else campagne.tolerance_pct, Decimal("100.0"))
    pds = poids if poids is not None else campagne.poids_surpression

    distinctes: dict[str, set[Decimal]] = {}
    for ligne in lignes:
        valeurs = distinctes.setdefault(ligne.code_postal, set())
        if ligne.part_plan is not None:
            valeurs.add(ligne.part_plan)
    divergent = any(len(v) > 1 for v in distinctes.values())

    cps = _par_code(lignes)
    t_reel = somme(c.reel for c in cps.values())
    t_prev = somme(c.reel_prec for c in cps.values())
    t_dep = somme(c.depense for c in cps.values())
    t_part = somme(c.part for c in cps.values())
    n_total = len(cps)
    n_plan = len([c for c in cps.values() if c.part is not None and c.part > 0])

    with localcontext(EXACT):
        bas, haut = _UN - tol, _UN + tol
        manque: list[Decimal | None] = []
        trop: list[Decimal | None] = []
        manque_prev: list[Decimal | None] = []
        trop_prev: list[Decimal | None] = []
        eur: list[Decimal | None] = []
        conformes = 0
        for c in cps.values():
            part_rel = diviser_ou_nul(c.part, t_part)
            plan = _mul(part_rel, t_reel)
            plan_prev = _mul(part_rel, t_prev)
            if plan is not None and plan > 0:
                manque.append(plus_grand(_ZERO, plan * bas - c.reel))
                if plan * bas <= c.reel <= plan * haut:
                    conformes += 1
            exces = plus_grand(_ZERO, c.reel - (plan if plan is not None else _ZERO) * haut)
            trop.append(exces)
            if plan_prev is not None and plan_prev > 0:
                manque_prev.append(plus_grand(_ZERO, plan_prev * bas - c.reel_prec))
            trop_prev.append(plus_grand(_ZERO, c.reel_prec - (plan_prev if plan_prev is not None else _ZERO) * haut))
            eur.append(_mul(diviser_ou_nul(exces, c.reel), c.depense))
        a_manque, a_trop = somme(manque) or _ZERO, somme(trop) or _ZERO
        a_manque_prev, a_trop_prev = somme(manque_prev) or _ZERO, somme(trop_prev) or _ZERO

        def score(m: Decimal, t: Decimal, total: Decimal | None) -> Decimal | None:
            sous = _pct(m, total)
            sur = _mul(diviser_ou_nul(_mul(pds, t), total), _CENT)
            brut = None if sous is None or sur is None else _CENT - sous - sur
            return plus_grand(_ZERO, _arr(brut))

        n_cp = n_total
        res: Json = {
            "maille_calcul": "cp",
            "tolerance_pct": arrondir(tol * _CENT, 2),
            "overpressure_weight": pds,
            "plan_divergent": divergent,
            "n_cp": n_cp,
            "n_cp_plan": n_plan,
            "plan_couverture_pct": _arr(_pct(Decimal(n_plan), Decimal(n_total)), 1),
            "conformes_pct": _arr(_pct(Decimal(conformes), Decimal(n_cp)), 1),
            "sous_pression_imps": arrondir(a_manque),
            "sur_pression_imps": arrondir(a_trop),
            "sous_pression_pct": _arr(_pct(a_manque, t_reel), 2),
            "sur_pression_pct": _arr(_pct(a_trop, t_reel), 2),
            "sur_pression_eur": arrondir(somme(eur) or _ZERO, 2),
            "impressions_totales": t_reel,
            "depense_totale": t_dep if t_dep is not None else _ZERO,
            "score": score(a_manque, a_trop, t_reel),
            "score_prev_7j": score(a_manque_prev, a_trop_prev, t_prev),
            "prev_7j_calculable": (t_prev if t_prev is not None else _ZERO) > 0,
            "calculable": True,
        }
    if n_cp == 0 or t_reel is None or t_reel <= 0:
        return {"error": "aucune_donnee", "calculable": False, "n_cp": n_cp}
    if n_plan == 0:
        return {
            "error": "plan_absent",
            "calculable": False,
            "n_cp": n_cp,
            "n_cp_plan": 0,
            "plan_couverture_pct": 0,
            "impressions_totales": t_reel,
        }
    return res


@dataclass(frozen=True)
class _Situe:
    code_postal: str
    cp: _Cp
    code_dept: str
    nom_dept: str | None
    code_region: str
    nom_region: str


def _premier_non_nul(valeurs: Iterable[str | None]) -> str | None:
    for v in valeurs:
        if v is not None:
            return v
    return None


def alignement_par_maille(
    lignes: Sequence[LigneCp],
    referentiel: Referentiel,
    campagne: ParametresCampagne | None,
    maille: str = "departement",
    parent: str | None = None,
    tolerance: Decimal | None = None,
    limite: int | None = 500,
) -> Json:
    """`alignement_par_maille(campagne, maille, parent, tolérance, limite)`.

    `limite=None` = `LIMIT NULL` du SQL (aucune limite) ; une limite négative lève, comme Postgres
    (« LIMIT must not be negative ») — relecture de phase 1, M3.

    L'ordre des unités à volume déplacé ÉGAL n'est pas défini en SQL (tri non stable) : il est rendu ici dans l'ordre
    des codes. Les unités sans plan (volume NULL) sont classées en DERNIER pour la limite (`NULLS LAST`), mais en TÊTE
    de la liste rendue : le `jsonb_agg(… ORDER BY volume_deplace DESC)` final, sans `NULLS LAST`, les remonte.
    """
    if maille not in MAILLES:
        raise ValueError(f"maille inconnue: {maille}")
    if campagne is None:
        return {"error": "campagne_introuvable"}
    # `v_tol` n'est lu que pour détecter une campagne absente : il n'entre dans aucune sortie.
    _ = tolerance

    situes: list[_Situe] = []
    for code, c in _par_code(lignes).items():
        if code not in referentiel.dept_du_cp:
            continue
        dept = referentiel.dept_du_cp[code]
        if dept is None or dept not in referentiel.departements:
            continue
        nom_dept, region = referentiel.departements[dept]
        nom_region = referentiel.regions.get(region) if region is not None else None
        situes.append(
            _Situe(code, c, dept, nom_dept, region if region is not None else "HORS", nom_region or "Hors region")
        )

    def garde(s: _Situe) -> bool:
        return (
            parent is None
            or (maille == "departement" and s.code_region == parent)
            or (maille == "cp" and s.code_dept == parent)
        )

    t_reel = somme(s.cp.reel for s in situes)
    t_part = somme(s.cp.part for s in situes)
    cle: Callable[[_Situe], str] = (
        (lambda s: s.code_region)
        if maille == "region"
        else (lambda s: s.code_dept)
        if maille == "departement"
        else (lambda s: s.code_postal)
    )
    groupes: dict[str, list[_Situe]] = {}
    for s in situes:
        if garde(s):
            groupes.setdefault(cle(s), []).append(s)

    unites: list[Json] = []
    for code, membres in groupes.items():
        reel = somme(m.cp.reel for m in membres) or _ZERO
        part = somme(m.cp.part for m in membres)
        depense = somme(m.cp.depense for m in membres)
        nom = (
            _premier_non_nul(m.nom_region for m in membres)
            if maille == "region"
            else _premier_non_nul(m.nom_dept for m in membres)
            if maille == "departement"
            else code
        )
        plan = _mul(diviser_ou_nul(part, t_part), t_reel)
        ecart = None
        if part is not None and part > 0 and plan is not None:
            with localcontext(EXACT):
                ecart = arrondir((diviser(reel, plan) - _UN) * _CENT, 1)
        hors_plan: bool | None
        if part is None:
            hors_plan = None if reel > 0 else False
        else:
            hors_plan = part == 0 and reel > 0
        with localcontext(EXACT):
            volume = None if plan is None else abs(reel - plan)
        unites.append(
            {
                "code": code,
                "nom": nom,
                "impressions": int(arrondir(reel)),
                "spend": _arr(depense, 2),
                "cpm": _arr(_mul(diviser_ou_nul(depense, reel), Decimal(1000)), 2),
                "plan": _arr(plan),
                "ecart_pct": ecart,
                "hors_plan": hors_plan,
                "volume_deplace": volume,
            }
        )
    # ORDER BY volume_deplace DESC NULLS LAST LIMIT, puis jsonb_agg ORDER BY volume_deplace DESC (NULLS FIRST).
    avec = sorted((u for u in unites if u["volume_deplace"] is not None), key=lambda u: -u["volume_deplace"])
    sans = [u for u in unites if u["volume_deplace"] is None]
    if limite is not None and limite < 0:
        raise ValueError("LIMIT must not be negative")
    gardees = [*avec, *sans][:limite]
    finale = [u for u in gardees if u["volume_deplace"] is None] + [
        u for u in gardees if u["volume_deplace"] is not None
    ]
    return {"maille": maille, "parent": parent, "n_total": len(groupes), "unites": finale}


@dataclass(frozen=True)
class StrategieSuivi:
    """La stratégie la plus récente : ce que lisent `get_campaign_expected` et `get_campaign_suivi`."""

    prevue: StrategiePrevue
    mode_hors_zone: str | None


def _concat(*morceaux: Decimal | str | int | None) -> str | None:
    """`a || b || …` : NULL dès qu'un morceau l'est ; un numeric s'écrit comme `numeric_out`."""
    if any(m is None for m in morceaux):
        return None
    return "".join(texte(m) if isinstance(m, Decimal) else str(m) for m in morceaux)


def suivi(
    strategie: StrategieSuivi | None,
    jours: Sequence[LigneJour],
    lignes: Sequence[LigneCp],
    multiplicateurs_actifs: Sequence[Decimal],
    attendu: Decimal | None,
    acteurs: Sequence[str] | None = None,
) -> Json:
    """La partie décisionnelle de `get_campaign_suivi(campagne, acteurs)`.

    `multiplicateurs_actifs` : les `bid_multiplier` des lignes actives du plan ; `attendu` : `get_campaign_expected`
    (GLOBAL, jamais filtré par acteur, comme en SQL).
    """
    if strategie is None:
        return {"error": "no_strategy"}
    s, mode = strategie.prevue, strategie.mode_hors_zone

    def retenu(acteur: str) -> bool:
        return acteurs is None or acteur in acteurs

    jours_f = [j for j in jours if retenu(j.acteur)]
    if not jours_f:
        return {"error": "no_rollup"}
    jour_au = max(j.jour for j in jours_f)
    depense = somme(j.depense for j in jours_f) or _ZERO
    imps = int(somme(Decimal(j.impressions) for j in jours_f) or _ZERO)

    temps_pct = None
    if s.jour_debut is not None and s.jour_fin is not None and s.jour_fin > s.jour_debut:
        temps_pct = fraction_du_temps(s.jour_debut, s.jour_fin, jour_au)
    budget_pct = None
    if s.total_budget is not None and s.total_budget > 0:
        budget_pct = _arr(_pct(depense, s.total_budget), 1)
    indice = None
    if budget_pct is not None and (temps_pct if temps_pct is not None else _ZERO) > 0:
        indice = _arr(diviser_ou_nul(budget_pct, temps_pct), 2)
    cpm_reel = _arr(_mul(diviser(depense, Decimal(imps)), Decimal(1000)), 2) if imps > 0 else None
    cpm_ecart = None
    if cpm_reel is not None and s.forecast_cpm is not None and s.forecast_cpm > 0:
        with localcontext(EXACT):
            cpm_ecart = arrondir(diviser(cpm_reel - s.forecast_cpm, s.forecast_cpm) * _CENT, 1)

    cp_f = [ligne for ligne in lignes if retenu(ligne.acteur)]
    total_cp = int(somme(Decimal(x.impressions) for x in cp_f) or _ZERO)
    in_imps = int(somme(Decimal(x.impressions) for x in cp_f if x.en_cible) or _ZERO)
    out_imps = int(somme(Decimal(x.impressions) for x in cp_f if not x.en_cible) or _ZERO)

    in_share = out_share = None
    if total_cp > 0:
        in_share = _arr(_pct(Decimal(in_imps), Decimal(total_cp)), 1)
        out_share = _arr(_pct(Decimal(out_imps), Decimal(total_cp)), 1)

    def dans_le_plan(m: Decimal) -> bool:
        return m > 0 if mode == MODE_STRICT else m > 1

    plan_in = len([m for m in multiplicateurs_actifs if dans_le_plan(m)])
    plan_out = len([m for m in multiplicateurs_actifs if not dans_le_plan(m)])
    demande = _max_numeric(multiplicateurs_actifs)
    obtenu = None
    if mode == MODE_STRICT:
        demande = None
    elif plan_in > 0 and plan_out > 0 and out_imps > 0:
        obtenu = _arr(
            diviser_ou_nul(diviser(Decimal(in_imps), Decimal(plan_in)), diviser(Decimal(out_imps), Decimal(plan_out))),
            2,
        )

    base_objectif = None
    if s.kpi_target is not None and s.kpi_target > 0 and s.objective_code == OBJECTIF_IMPRESSIONS:
        base_objectif = "kpi"
    elif s.total_budget is not None and s.forecast_cpm is not None and s.forecast_cpm > 0:
        base_objectif = "forecast"
    objectif_pct = None
    if attendu is not None and attendu > 0:
        objectif_pct = _arr(_pct(Decimal(imps), attendu), 1)

    alertes: list[Json] = []
    if indice is not None and indice < RYTHME_RETARD:
        if temps_pct is None or budget_pct is None:  # impossible : indice non NULL ⇒ les deux le sont
            raise ValueError("rythme sans temps ni budget")
        with localcontext(EXACT):
            retard = arrondir(temps_pct - budget_pct)
        alertes.append(
            {
                "kind": "pacing",
                "severity": "danger" if indice < RYTHME_RETARD_GRAVE else "warning",
                "title": _concat("Pacing en retard de ", retard, " points"),
                "detail": _concat(budget_pct, " % du budget pour ", temps_pct, " % du temps"),
            }
        )
    elif indice is not None and indice > RYTHME_AVANCE:
        if temps_pct is None or budget_pct is None:
            raise ValueError("rythme sans temps ni budget")
        with localcontext(EXACT):
            avance = arrondir(budget_pct - temps_pct)
        alertes.append(
            {
                "kind": "pacing",
                "severity": "danger" if indice > RYTHME_AVANCE_GRAVE else "warning",
                "title": _concat("Pacing en avance de ", avance, " points"),
                "detail": _concat(budget_pct, " % du budget pour ", temps_pct, " % du temps"),
            }
        )
    if cpm_reel is not None and s.forecast_cpm is not None:
        with localcontext(EXACT):
            depasse = cpm_reel > s.forecast_cpm * CPM_DEPASSEMENT
        if depasse:
            alertes.append(
                {
                    "kind": "cpm",
                    "severity": "danger",
                    "title": _concat("CPM à ", cpm_reel, " € — +", cpm_ecart, " % vs prévu"),
                    "detail": _concat("CPM prévu : ", arrondir(s.forecast_cpm, 2), " €"),
                }
            )

    # Codes groupés par (code, in_target, planned_share), sommes FILTRÉES par acteur (0 si aucun acteur retenu).
    groupes: dict[tuple[str, bool, Decimal | None], list[Decimal]] = {}
    for ligne in lignes:
        g = groupes.setdefault((ligne.code_postal, ligne.en_cible, ligne.part_plan), [_ZERO, _ZERO])
        if retenu(ligne.acteur):
            with localcontext(EXACT):
                g[0] = g[0] + Decimal(ligne.impressions)
                g[1] = g[1] + ligne.depense
    sous: list[tuple[Decimal, Decimal]] = []
    for (_code, cible, part), (im, sp) in groupes.items():
        if not cible or part is None or not part > 0:
            continue
        ratio = _pct(diviser_ou_nul(im, Decimal(total_cp)), part)
        if ratio is not None and ratio < CP_SOUS_PLAN_PCT:
            sous.append((im, sp))
    if sous:
        sp_sous = somme(sp for _im, sp in sous) or _ZERO
        im_sous = somme(im for im, _sp in sous) or _ZERO
        alertes.append(
            {
                "kind": "zones_under",
                "severity": "warning",
                "title": _concat(len(sous), " CP cibles sous 70 % du plan"),
                "detail": _concat(
                    arrondir(sp_sous),
                    " € de spend · ",
                    _arr(_pct(im_sous, Decimal(in_imps)), 1),
                    " % du volume cible",
                ),
            }
        )
    if mode == MODE_STRICT and (out_share if out_share is not None else _ZERO) > FUITE_PCT:
        alertes.append(
            {
                "kind": "leak",
                "severity": "warning",
                "title": _concat(out_share, " % du volume hors de la cible"),
                "detail": "Zones strictes : la diffusion hors cible devrait être ~0",
            }
        )

    sous_objectif = sur_objectif = 0
    if attendu is not None and attendu > 0:
        for (_code, cible, part), (im, _sp) in groupes.items():
            if not cible or part is None or not part > 0:
                continue
            with localcontext(EXACT):
                ratio = diviser(im, part * attendu) * _CENT
            sous_objectif += ratio < OBJECTIF_SOUS_PCT
            sur_objectif += ratio > OBJECTIF_SUR_PCT

    return {
        "jour_au": jour_au,
        "pacing": {
            "spend": arrondir(depense, 2),
            "total_budget": s.total_budget,
            "budget_pct": budget_pct,
            "time_pct": temps_pct,
            "index": indice,
        },
        "cpm": {"real": cpm_reel, "forecast": _arr(s.forecast_cpm, 2), "delta_pct": cpm_ecart},
        "pressure": {
            "mode": mode if mode is not None else MODE_STRICT,
            "requested": demande,
            "obtained": obtenu,
            "in_target_share": in_share,
            "out_share": out_share,
        },
        "objective": {
            "code": s.objective_code,
            "basis": base_objectif,
            "kpi_target": s.kpi_target,
            "realized": imps,
            "expected": arrondir(attendu if attendu is not None else _ZERO),
            "pct": objectif_pct,
        },
        "objective_zones": {"under": sous_objectif, "over": sur_objectif},
        "alerts": alertes,
    }
