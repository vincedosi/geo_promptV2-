"""`tests/unit/demo/convergence.test.ts` rejoué en Python : même boucle (simulateur → rebid, cible fixe), mêmes appels
que le TS au bit près, et mêmes conclusions (l'écart à la cible décroît strictement sur trois tours).
"""

from typing import Any

from optimisation.noyau.historique.rebid_plafonne import RebidItemInput, compute_rebid_weights
from optimisation.noyau.nombres import somme_gauche
from tests.parite.historique import contenu, decoder, identique, rebid, simulation
from tests.simulation.simulateur import SimInput, SimItem, simulate_delivery

ITEMS = [("z:a", ["1", "2"]), ("z:b", ["3", "4"]), ("z:c", ["5", "6"]), ("z:d", ["7", "8"])]
AUDIENCE: dict[str, float | None] = {
    cp: 800.0 + i * 120 for i, cp in enumerate(["1", "2", "3", "4", "5", "6", "7", "8"])
}
CIBLE = {"z:a": 0.25, "z:b": 0.25, "z:c": 0.25, "z:d": 0.25}


def _entree(encheres: dict[str, float], periode: int) -> SimInput:
    total = somme_gauche(encheres.values()) or 1
    items = [SimItem("z", i, encheres[i] / total, cps) for i, cps in ITEMS]
    return SimInput(items=items, audience_by_cp=AUDIENCE, seed=42, period=periode, total_volume=1_000_000)


def _parts(encheres: dict[str, float], periode: int) -> dict[str, float]:
    lignes = simulate_delivery(_entree(encheres, periode))
    par_cp = {r.postal_code: r.impressions for r in lignes}
    total = somme_gauche(r.impressions for r in lignes) or 1
    return {i: somme_gauche(par_cp.get(cp, 0.0) for cp in cps) / total for i, cps in ITEMS}


def _ecart(encheres: dict[str, float], periode: int) -> float:
    parts = _parts(encheres, periode)
    return somme_gauche(abs((parts[i] - CIBLE[i]) * 100) for i, _ in ITEMS) / len(ITEMS)


def test_la_boucle_converge_comme_en_ts() -> None:
    encheres = {"z:a": 25.0, "z:b": 25.0, "z:c": 25.0, "z:d": 25.0}
    ecarts: list[float] = []
    appels_rebid: list[list[RebidItemInput]] = []
    for periode in (1, 2, 3):
        ecarts.append(_ecart(encheres, periode))
        parts = _parts(encheres, periode)
        entree = [RebidItemInput("z", i, encheres[i], CIBLE[i], parts[i]) for i, _ in ITEMS]
        appels_rebid.append(entree)
        encheres = {r.item_id: r.new_weight for r in compute_rebid_weights(entree)}
    assert ecarts[0] > 2
    assert ecarts[2] < ecarts[0] * 0.8
    assert ecarts[1] < ecarts[0]
    assert ecarts[2] < ecarts[1]

    # Les trois appels au rebid du TS : mêmes ENTRÉES, donc toute la chaîne simulateur → parts est identique.
    ts = [
        c for c in contenu()["cas"] if c["source"] == "convergence.test.ts" and c["fonction"] == "computeRebidWeights"
    ]
    assert len(ts) == 3
    for py, cas in zip(appels_rebid, ts, strict=True):
        assert identique([vars(x) for x in py], decoder(cas["entree"]["args"])[0])


def test_appels_de_la_convergence_rejoues() -> None:
    cas: list[dict[str, Any]] = [c for c in contenu()["cas"] if c["source"] == "convergence.test.ts"]
    assert len(cas) == 9
    for c in cas:
        args = decoder(c["entree"]["args"])
        py = simulation(args) if c["fonction"] == "simulateDelivery" else rebid(args)
        assert identique(py, decoder(c["sortie"])), c["id"]
