"""Sanity tests sur le wrapper Hoeffding (pas d'accès Modal/Supabase requis)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from bidding_ml.algos.hoeffding import HoeffdingAlgo  # noqa: E402
from bidding_ml.algos.base import MULTIPLIER_MIN, MULTIPLIER_MAX  # noqa: E402


def _ctx(d: int = 5, tier: str = "urban") -> dict:
    return {
        "postal_code": "75001",
        "date": "2026-03-10",
        "day_of_week": 0, "is_weekend": False,
        "days_since_start": d, "is_post_drift": False,
        "tier": tier, "recent_ctr": 0.02, "recent_visit_rate": 0.05,
        "win_rate_7d": 0.4,
    }


def test_predict_returns_clamped_float():
    algo = HoeffdingAlgo({})
    m = algo.predict(_ctx())
    assert isinstance(m, float)
    assert MULTIPLIER_MIN <= m <= MULTIPLIER_MAX


def test_learn_then_predict_no_crash():
    algo = HoeffdingAlgo({})
    for i in range(10):
        algo.learn_one(_ctx(d=i), reward=float(i))
    m = algo.predict(_ctx())
    assert MULTIPLIER_MIN <= m <= MULTIPLIER_MAX


def test_state_roundtrip_preserves_predictions():
    algo = HoeffdingAlgo({})
    for i in range(50):
        algo.learn_one(_ctx(d=i), reward=float(i % 5))
    ctx = _ctx(d=99)
    m_before = algo.predict(ctx)

    state = algo.get_state()
    algo2 = HoeffdingAlgo({})
    algo2.load_state(state)
    m_after = algo2.predict(ctx)

    assert abs(m_before - m_after) < 1e-6
