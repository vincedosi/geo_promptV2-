"""Décodage des fixtures TS et appel du noyau Python avec les mêmes arguments positionnels.

Encodage des fixtures (README) : `{"$map": [[k, v], …]}`, `{"$set": […]}`, `{"$undefined": true}`,
`{"$nombre": "Infinity" | "-Infinity" | "NaN" | "-0"}`. Une `Map` décodée devient une `Carte` (un `dict` dont la
comparaison vérifie AUSSI l'ordre des clés : l'ordre d'insertion d'une `Map` fait partie de la sortie).
"""

import dataclasses
import gzip
import json
import math
from collections.abc import Callable
from pathlib import Path
from typing import Any, Literal, cast

from optimisation.noyau.part_prevue import parts_prevues, poids_prevu, univers_de_zone
from optimisation.noyau.plan_risque import generer_plan_cp
from optimisation.noyau.plan_zone import plan_cp_de_zone
from optimisation.noyau.reglage import plans_par_plateforme, reglage_du_plan, sorties_poids
from optimisation.noyau.regroupement import plier_par_code_postal, regrouper_par_code_postal
from optimisation.noyau.types import (
    AVerifier,
    Bornes,
    ChoixPlateforme,
    CpZone,
    HorsZonePrevue,
    Jeu,
    LigneCouverture,
    PlateformePoids,
    RefusReglage,
    ReglagePlan,
    UnitePrevue,
    VolumesAttendus,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures"


class Indefini:
    """`undefined` JS (argument absent ou élément `undefined`)."""

    def __repr__(self) -> str:
        return "undefined"


INDEFINI = Indefini()


class Carte(dict[Any, Any]):
    """Une `Map` JS décodée : comparée clés ET ordre."""


def decoder(v: Any) -> Any:
    if isinstance(v, list):
        return [decoder(x) for x in v]
    if isinstance(v, dict):
        if "$map" in v and len(v) == 1:
            return Carte((decoder(k), decoder(x)) for k, x in v["$map"])
        if "$set" in v and len(v) == 1:
            return [decoder(x) for x in v["$set"]]
        if v == {"$undefined": True}:
            return INDEFINI
        if "$nombre" in v and len(v) == 1:
            return {"Infinity": math.inf, "-Infinity": -math.inf, "NaN": math.nan, "-0": -0.0}[v["$nombre"]]
        return {k: decoder(x) for k, x in v.items()}
    return v


def charger(nom: str) -> dict[str, Any]:
    with gzip.open(FIXTURES / nom, "rt", encoding="utf-8") as flux:
        return cast(dict[str, Any], json.load(flux))


def _absent(v: Any) -> bool:
    return v is None or v is INDEFINI


def _nombre(v: Any) -> float | None:
    return None if _absent(v) else float(v)


def cp_zone(d: dict[str, Any]) -> CpZone:
    return CpZone(
        code_postal=d["code_postal"],
        classe=d["classe"],
        pop_en_zone=float(d["pop_en_zone"]),
        pop_totale=float(d["pop_totale"]),
        retenu=bool(d["retenu"]),
    )


def jeu(d: dict[str, Any]) -> Jeu:
    return Jeu(mode_plan=d["mode_plan"], poids={k: float(x) for k, x in d.get("poids", {}).items()})


def ligne_couverture(d: dict[str, Any]) -> LigneCouverture:
    membres = d.get("membres")
    return LigneCouverture(
        code=d["code"],
        pop_en_zone=_nombre(d.get("pop_en_zone")),
        pop_totale=_nombre(d.get("pop_totale")),
        part=_nombre(d.get("part")),
        part_brute=_nombre(d.get("part_brute")),
        membres=tuple(membres) if isinstance(membres, list) else None,
        incluse=d.get("incluse") if isinstance(d.get("incluse"), bool) else None,
    )


def groupes(v: Any) -> dict[str, list[str]]:
    return {} if _absent(v) else {k: list(m) for k, m in v.items()}


def plateforme_poids(d: dict[str, Any]) -> PlateformePoids:
    return PlateformePoids(
        plateforme=d["plateforme"],
        maille=d["maille"],
        mecanisme=d["mecanisme"],
        valeur_min=_nombre(d.get("valeur_min")),
        valeur_max=_nombre(d.get("valeur_max")),
        nb_max_entrees=None if _absent(d.get("nb_max_entrees")) else int(d["nb_max_entrees"]),
        poids_groupe_cp=None if _absent(d.get("poids_groupe_cp")) else d["poids_groupe_cp"],
        branche=bool(d["branche"]),
        parametres_a_verifier=tuple(d["parametres_a_verifier"]),
    )


def reglage(v: Any) -> ReglagePlan | None:
    if _absent(v):
        return None
    b = v.get("bornes")
    a = v.get("a_verifier")
    return ReglagePlan(
        bornes=None if b is None else Bornes(min=float(b["min"]), max=float(b["max"])),
        poids_groupe_cp=v.get("poids_groupe_cp"),
        a_verifier=None if a is None else AVerifier(min=bool(a["min"]), max=bool(a["max"])),
    )


def volumes(v: Any) -> VolumesAttendus | None:
    if _absent(v):
        return None
    return VolumesAttendus(
        par_code={k: float(x) for k, x in v["par_code"].items()},
        total=float(v["total"]),
        univers=v.get("univers"),
    )


def codes(v: Any) -> list[str] | None:
    return None if _absent(v) else list(v)


def reglage_en_json(r: ReglagePlan) -> dict[str, Any]:
    sortie: dict[str, Any] = {}
    if r.bornes is not None:
        sortie["bornes"] = {"min": r.bornes.min, "max": r.bornes.max}
    if r.poids_groupe_cp is not None:
        sortie["poids_groupe_cp"] = r.poids_groupe_cp
    if r.a_verifier is not None:
        sortie["a_verifier"] = {"min": r.a_verifier.min, "max": r.a_verifier.max}
    return sortie


def _arg(args: list[Any], i: int) -> Any:
    return args[i] if i < len(args) else INDEFINI


# ── Un adaptateur par fonction TS : arguments positionnels décodés → noyau Python → sortie au format TS ──────────────


def _generer_plan_cp(a: list[Any]) -> Any:
    options = _arg(a, 3)
    semantique: Literal["repartition", "multiplicateur"] = (
        "repartition" if _absent(options) else options.get("semantique", "repartition")
    )
    bornes = None if _absent(options) or options.get("bornes") is None else options["bornes"]
    membres = _arg(a, 2)
    return generer_plan_cp(
        [cp_zone(x) for x in a[0]],
        jeu(a[1]),
        None if _absent(membres) else groupes(membres),
        semantique,
        None if bornes is None else Bornes(min=float(bornes["min"]), max=float(bornes["max"])),
    )


def _plier_par_code_postal(a: list[Any]) -> Any:
    return [
        {
            "code_postal": c.code_postal,
            "pop_en_zone": c.pop_en_zone,
            "pop_totale": c.pop_totale,
            "retenu": c.retenu,
            "classe": c.classe,
            "lignes": [dataclasses.asdict(ligne) for ligne in c.lignes],
        }
        for c in plier_par_code_postal([cp_zone(x) for x in a[0]])
    ]


def _regrouper_par_code_postal(a: list[Any]) -> Any:
    return [dataclasses.asdict(c) for c in regrouper_par_code_postal([cp_zone(x) for x in a[0]], jeu(a[1]))]


def _plan_cp_de_zone(a: list[Any]) -> Any:
    return plan_cp_de_zone(
        [ligne_couverture(x) for x in a[0]],
        float(a[1]),
        a[2],
        groupes(_arg(a, 3)),
        codes(_arg(a, 4)),
        reglage(_arg(a, 5)),
        volumes(_arg(a, 6)),
    )


def _plans_par_plateforme(a: list[Any]) -> Any:
    r = plans_par_plateforme(
        [ligne_couverture(x) for x in a[0]],
        [ChoixPlateforme(plateforme=c["plateforme"], seuil=float(c["seuil"])) for c in a[1]],
        a[2],
        groupes(_arg(a, 3)),
        [plateforme_poids(x) for x in a[4]],
        codes(_arg(a, 5)),
        volumes(_arg(a, 6)),
    )
    if isinstance(r, RefusReglage):
        return {"ok": False, "message": r.message}
    return {
        "ok": True,
        "plans": [
            {"plateforme": p.plateforme, "seuil": p.seuil, "reglage": reglage_en_json(p.reglage), "plan": p.plan}
            for p in r
        ],
    }


def _reglage_du_plan(a: list[Any]) -> Any:
    r = reglage_du_plan([plateforme_poids(x) for x in a[0]], list(a[1]))
    if isinstance(r, RefusReglage):
        return {"ok": False, "message": r.message}
    return {"ok": True, "reglage": reglage_en_json(r)}


def _sorties_poids(a: list[Any]) -> Any:
    sorties, avertissements = sorties_poids(
        [plateforme_poids(x) for x in a[0]], a[1], int(a[2]), list(a[3]["ajustements"])
    )
    return {"sorties": sorties, "avertissements": avertissements}


def _univers_de_zone(a: list[Any]) -> Any:
    recette = _arg(a, 1)
    if _absent(recette):
        return univers_de_zone(list(a[0]), None, None)
    return univers_de_zone(list(a[0]), recette.get("type"), recette.get("code"))


def _poids_prevu(a: list[Any]) -> Any:
    return poids_prevu(_nombre(a[0]), _nombre(a[1]), float(a[2]))


def _parts_prevues(a: list[Any]) -> Any:
    hz = _arg(a, 1)
    r = parts_prevues(
        [
            UnitePrevue(
                code=u["code"],
                membres=tuple(u["membres"]),
                part=_nombre(u["part"]),
                volume=_nombre(u["volume"]),
                classe=float(u["classe"]),
            )
            for u in a[0]
        ],
        None
        if _absent(hz)
        else HorsZonePrevue(part=float(hz["part"]), volume=_nombre(hz["volume"]), classe=float(hz["classe"])),
    )
    return {"par_unite": Carte(r.par_unite), "par_code": Carte(r.par_code), "hors_zone": r.hors_zone, "somme": r.somme}


ADAPTATEURS: dict[str, Callable[[list[Any]], Any]] = {
    "genererPlanCp": _generer_plan_cp,
    "plierParCodePostal": _plier_par_code_postal,
    "regrouperParCodePostal": _regrouper_par_code_postal,
    "planCpDeZone": _plan_cp_de_zone,
    "plansParPlateforme": _plans_par_plateforme,
    "reglageDuPlan": _reglage_du_plan,
    "sortiesPoids": _sorties_poids,
    "universDeZone": _univers_de_zone,
    "poidsPrevu": _poids_prevu,
    "partsPrevues": _parts_prevues,
}

# Critère § 5.1 : part prévue à 1e-12 relatif ; tout le reste (multiplicateurs, résumé…) à l'égalité EXACTE.
CLES_TOLERANTES = frozenset({"part_prevue", "par_unite", "par_code", "somme"})
TOLERANCE_RELATIVE = 1e-12


def ecarts(attendu: Any, obtenu: Any, chemin: str = "$", tolerant: bool = False) -> list[str]:
    """Les différences entre la sortie TS et la sortie Python, chemin par chemin (vide = parité)."""
    if isinstance(attendu, bool) or isinstance(obtenu, bool):
        return [] if attendu is obtenu else [f"{chemin}: {attendu!r} ≠ {obtenu!r}"]
    if isinstance(attendu, int | float) and isinstance(obtenu, int | float):
        a, o = float(attendu), float(obtenu)
        if a == o and math.copysign(1, a) == math.copysign(1, o):
            return []
        if math.isnan(a) and math.isnan(o):
            return []
        if tolerant and abs(a - o) <= TOLERANCE_RELATIVE * max(abs(a), abs(o)):
            return []
        return [f"{chemin}: {attendu!r} ≠ {obtenu!r}"]
    if isinstance(attendu, dict) and isinstance(obtenu, dict):
        diff: list[str] = []
        if set(attendu) != set(obtenu):
            return [f"{chemin}: clés {sorted(map(str, attendu))} ≠ {sorted(map(str, obtenu))}"]
        if isinstance(attendu, Carte) and list(attendu) != list(obtenu):
            return [f"{chemin}: ordre de la Map {list(attendu)[:5]}… ≠ {list(obtenu)[:5]}…"]
        for k in attendu:
            diff += ecarts(attendu[k], obtenu[k], f"{chemin}.{k}", tolerant or k in CLES_TOLERANTES)
        return diff
    if isinstance(attendu, list) and isinstance(obtenu, list):
        if len(attendu) != len(obtenu):
            return [f"{chemin}: {len(attendu)} éléments ≠ {len(obtenu)}"]
        diff = []
        for i, (x, y) in enumerate(zip(attendu, obtenu, strict=True)):
            diff += ecarts(x, y, f"{chemin}[{i}]", tolerant)
            if len(diff) > 20:
                break
        return diff
    return [] if attendu == obtenu and type(attendu) is type(obtenu) else [f"{chemin}: {attendu!r} ≠ {obtenu!r}"]


def rejouer(cas: dict[str, Any]) -> list[str]:
    args = decoder(cas["entree"]["args"])
    obtenu = ADAPTATEURS[cas["fonction"]](args)
    return ecarts(decoder(cas["sortie"]), obtenu)
