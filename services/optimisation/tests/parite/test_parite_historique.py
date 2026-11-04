"""PARITÉ des formules historiques et du simulateur (phase 1.4-1.5) : pour chaque appel enregistré par le TS
(`generer-fixtures-historique.ts`), le Python rend la MÊME sortie, au bit près (NaN, −0 et ordre des clés compris).

Sources : tests unitaires TS (rebid 4 + 3 de la convergence, `recaler` 4, simulateur 6 + 6 de la convergence), entrée
« 4 départements » figée, cas aux limites, 3 400 cas flottants aléatoires.
"""

from typing import Any

import pytest

from tests.parite.historique import contenu, identique, rejouer


def _cas() -> list[dict[str, Any]]:
    return list(contenu()["cas"])


COMPTES_ATTENDUS = {
    "rebid.test.ts / computeRebidWeights": 4,
    "simulation.test.ts / recaler": 4,
    "simulator.test.ts / simulateDelivery": 6,
    "convergence.test.ts / simulateDelivery": 6,
    "convergence.test.ts / computeRebidWeights": 3,
    "non-régression 4 départements / computeRebidWeights": 1,
    "non-régression 4 départements / recaler": 1,
    "limites / computeRebidWeights": 8,
    "limites / recaler": 8,
    "limites / simulateDelivery": 7,
    "aléatoires / computeRebidWeights": 1500,
    "aléatoires / recaler": 1500,
    "aléatoires / simulateDelivery": 400,
}


def test_les_comptes_sont_ceux_du_generateur() -> None:
    assert contenu()["comptes"] == COMPTES_ATTENDUS
    assert len(_cas()) == sum(COMPTES_ATTENDUS.values())
    assert all("erreur" not in c for c in _cas())


@pytest.mark.parametrize("source", sorted({k.split(" / ")[0] for k in COMPTES_ATTENDUS}))
def test_parite_exacte(source: str) -> None:
    ecarts = []
    for cas in _cas():
        if cas["source"] != source:
            continue
        py, ts = rejouer(cas)
        if not identique(py, ts):
            ecarts.append(cas["id"])
    assert ecarts == []


def test_quatre_departements_chiffres_du_document() -> None:
    """Les chiffres du § 2.7, recalculés par le PYTHON (pas seulement égaux au TS)."""
    from optimisation.noyau.math_js import max_js
    from tests.parite.historique import decoder

    rebid = next(
        c for c in _cas() if c["source"] == "non-régression 4 départements" and c["fonction"] == "computeRebidWeights"
    )
    items = decoder(rebid["entree"]["args"])[0]
    assert [i["item_id"] for i in items] == ["13", "59", "75", "29"]
    facteurs = [i["expected_share"] / max_js(i["actual_share"], 0.001) for i in items]
    assert [f"{f:.4f}" for f in facteurs] == ["1.2089", "1.1585", "0.6172", "0.5873"]
    assert [f"{i['item_weight']:.1f}" for i in items] == ["48.1", "32.5", "10.3", "9.1"]
    py, _ = rejouer(rebid)
    assert [f"{r['new_weight']:.1f}" for r in py] == ["54.1", "35.0", "5.9", "5.0"]

    recal = next(c for c in _cas() if c["source"] == "non-régression 4 départements" and c["fonction"] == "recaler")
    py, _ = rejouer(recal)
    assert [f"{c:.3f}" for c in py["corrections"].values()] == ["1.164", "1.125", "0.680", "0.653"]
