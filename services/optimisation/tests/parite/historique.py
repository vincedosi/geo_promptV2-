"""Lecture de `fixtures/historique.json.gz` (phase 1.4-1.5) et rejeu de chaque appel TS par le Python.

Décodeur propre à ce fichier (et non celui d'`adaptation.py`, qui importe tout le noyau du plan) : même encodage,
mais chaque nombre devient un `float`, comme un nombre JS — `1` et `1.0` ne se distinguent pas en TS.
"""

import gzip
import math
from collections.abc import Callable
from functools import cache
from pathlib import Path
from typing import Any

from optimisation.noyau.historique.rebid_plafonne import RebidItemInput, compute_rebid_weights
from optimisation.noyau.historique.recalage_amorti import CpRecalage, ParamsRecalage, recaler
from tests.simulation.simulateur import SimInput, SimItem, simulate_delivery

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "historique.json.gz"

_NOMBRES = {"Infinity": math.inf, "-Infinity": -math.inf, "NaN": math.nan, "-0": -0.0}


def decoder(v: Any) -> Any:
    """`$map` → `dict` (ordre d'insertion), `$set` → liste, `$nombre` → flottant spécial, entiers → `float`."""
    if isinstance(v, bool) or v is None or isinstance(v, str):
        return v
    if isinstance(v, int | float):
        return float(v)
    if isinstance(v, list):
        return [decoder(x) for x in v]
    if "$map" in v and len(v) == 1:
        return {decoder(k): decoder(x) for k, x in v["$map"]}
    if "$set" in v and len(v) == 1:
        return [decoder(x) for x in v["$set"]]
    if v == {"$undefined": True}:
        return None
    if "$nombre" in v and len(v) == 1:
        return _NOMBRES[v["$nombre"]]
    return {k: decoder(x) for k, x in v.items()}


@cache
def contenu() -> dict[str, Any]:
    import json

    with gzip.open(FIXTURE, "rt", encoding="utf-8") as flux:
        brut: dict[str, Any] = json.load(flux)
    return brut


def identique(a: Any, b: Any) -> bool:
    """Égalité au BIT près : NaN = NaN, −0 ≠ +0, clés de dictionnaire comparées dans l'ordre."""
    if (
        isinstance(a, float | int)
        and isinstance(b, float | int)
        and not isinstance(a, bool)
        and not isinstance(b, bool)
    ):
        if math.isnan(a) or math.isnan(b):
            return math.isnan(a) and math.isnan(b)
        return a == b and math.copysign(1.0, a) == math.copysign(1.0, b)
    if isinstance(a, dict) and isinstance(b, dict):
        return len(a) == len(b) and all(
            identique(ka, kb) and identique(va, vb) for (ka, va), (kb, vb) in zip(a.items(), b.items(), strict=True)
        )
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(identique(x, y) for x, y in zip(a, b, strict=True))
    return bool(a == b) and type(a) is type(b)


def rebid(args: list[Any]) -> Any:
    sortie = compute_rebid_weights([RebidItemInput(**d) for d in args[0]])
    return [vars(r) for r in sortie]


def cp_recalage(d: dict[str, Any]) -> CpRecalage:
    return CpRecalage(d["code_postal"], d.get("cluster_id"), d["multiplicateur"], d["part_en_zone"])


def params_recalage(d: dict[str, Any]) -> ParamsRecalage:
    return ParamsRecalage(d["amortissement"], d["seuilDilution"], d["baisseDilues"])


def recalage(args: list[Any]) -> Any:
    r = recaler([cp_recalage(c) for c in args[0]], args[1], args[2], params_recalage(args[3]))
    return {"multiplicateurs": r.multiplicateurs, "corrections": r.corrections, "dilues": r.dilues}


def sim_input(d: dict[str, Any]) -> SimInput:
    return SimInput(
        items=[SimItem(i["zone_id"], i["item_id"], i["bid_share"], i["cps"]) for i in d["items"]],
        audience_by_cp=d["audienceByCp"],
        seed=d["seed"],
        period=d["period"],
        total_volume=d["totalVolume"],
        gain=d.get("gain"),
        noise=d.get("noise"),
    )


def simulation(args: list[Any]) -> Any:
    return [vars(r) for r in simulate_delivery(sim_input(args[0]))]


ADAPTATEURS: dict[str, Callable[[list[Any]], Any]] = {
    "computeRebidWeights": rebid,
    "recaler": recalage,
    "simulateDelivery": simulation,
}


def rejouer(cas: dict[str, Any]) -> tuple[Any, Any]:
    """(sortie Python, sortie TS) d'un cas enregistré."""
    return ADAPTATEURS[cas["fonction"]](decoder(cas["entree"]["args"])), decoder(cas["sortie"])
