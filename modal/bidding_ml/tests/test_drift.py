"""Sanity test sur le scan de drift (logique pure, pas d'I/O)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from bidding_ml.drift_detection import _aggregate_window, _classify  # noqa: E402


def test_aggregate_window_per_postal_code():
    rows = [
        {"postal_code": "75001", "impressions": 1000, "clicks": 20, "spend": 50, "conversions": 4},
        {"postal_code": "75001", "impressions": 500, "clicks": 10, "spend": 25, "conversions": 2},
        {"postal_code": "75002", "impressions": 1000, "clicks": 5, "spend": 60, "conversions": 1},
    ]
    agg = _aggregate_window(rows)
    assert set(agg.keys()) == {"75001", "75002"}
    assert agg["75001"]["n_days"] == 2
    assert agg["75001"]["cpl"] == 75 / 6  # spend/conversions
    assert abs(agg["75001"]["ctr"] - 30 / 1500) < 1e-9


def test_classify_thresholds():
    assert _classify(0.10, 0.30, 0.50) is None
    assert _classify(0.35, 0.30, 0.50) == "medium"
    assert _classify(-0.55, 0.30, 0.50) == "high"
