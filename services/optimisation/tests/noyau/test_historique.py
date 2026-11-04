"""Les assertions de `tests/unit/pacing/rebid.test.ts` et de `recaler` (`simulation.test.ts`), réécrites sur le
Python — la parité bit à bit est dans `tests/parite/test_parite_historique.py` ; ici, le comportement attendu.
"""

import pytest

from optimisation.noyau.historique.rebid_plafonne import REBID_CAP, RebidItemInput, compute_rebid_weights
from optimisation.noyau.historique.recalage_amorti import CpRecalage, ParamsRecalage, recaler


def _it(item_id: str, w: float, e: float, a: float) -> RebidItemInput:
    return RebidItemInput("z1", item_id, w, e, a)


def test_rebid_renforce_le_sous_servi_et_renormalise() -> None:
    a, b = compute_rebid_weights([_it("a", 50, 0.5, 0.7), _it("b", 50, 0.5, 0.3)])
    assert b.new_weight > a.new_weight
    assert a.new_weight + b.new_weight == pytest.approx(100, abs=1e-3)


def test_rebid_plafond() -> None:
    (seul,) = compute_rebid_weights([_it("a", 100, 0.5, 0.001)])
    assert seul.new_weight == pytest.approx(100, abs=1e-3)
    assert REBID_CAP == 0.5


def test_rebid_plan_conforme_inchange() -> None:
    a, b = compute_rebid_weights([_it("a", 60, 0.6, 0.6), _it("b", 40, 0.4, 0.4)])
    assert a.new_weight == pytest.approx(60, abs=0.05)
    assert b.new_weight == pytest.approx(40, abs=0.05)


def test_rebid_sans_delivrance_pousse_au_plafond() -> None:
    a, _ = compute_rebid_weights([_it("a", 50, 0.5, 0), _it("b", 50, 0.5, 1)])
    assert a.new_weight > 50


P = ParamsRecalage(amortissement=0.8, seuil_dilution=20, baisse_dilues=0.6)


def _jeu() -> list[CpRecalage]:
    def cp(code: str, zone: str, m: float, pz: float, pt: float) -> CpRecalage:
        return CpRecalage(code, zone, m, (pz / pt) * 100)

    return [
        cp("69001", "dense", 1.4, 30000, 40000),
        cp("69002", "dense", 1.2, 25000, 36000),
        cp("69003", "dense", 1.1, 20000, 32000),
        cp("07001", "rural", 1.3, 3000, 3200),
        cp("07002", "rural", 1.2, 2800, 3000),
        cp("07003", "rural", 1.0, 2500, 2800),
        cp("69100", "dense", 0.4, 3000, 50000),
        cp("07100", "rural", 0.3, 200, 4000),
    ]


def test_recaler_releve_le_sous_servi() -> None:
    rc = recaler(_jeu(), {"dense": 900, "rural": 100}, {"dense": 0.5, "rural": 0.5}, P)
    assert rc.corrections["rural"] > 1
    assert rc.corrections["dense"] < 1


def test_recaler_baisse_les_dilues() -> None:
    rc = recaler(_jeu(), {"dense": 1, "rural": 1}, {"dense": 0.5, "rural": 0.5}, P)
    assert "69100" in rc.dilues
    assert "69001" not in rc.dilues


def test_recaler_recentre_sur_un() -> None:
    rc = recaler(_jeu(), {"dense": 900, "rural": 100}, {"dense": 0.5, "rural": 0.5}, P)
    v = list(rc.multiplicateurs.values())
    assert sum(v) / len(v) == pytest.approx(1, abs=5e-3)
