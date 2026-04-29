"""Sanity test sur la pipeline serialization/deserialization complète."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from bidding_ml.algos.hoeffding import HoeffdingAlgo  # noqa: E402
from bidding_ml.serialization import deserialize_model, serialize_model  # noqa: E402


def test_serialize_format():
    algo = HoeffdingAlgo({})
    state = algo.get_state()
    assert "scaler" in state and state["scaler"]["_serializer"] == "pickle_b64"
    assert "model" in state and state["model"]["_serializer"] == "pickle_b64"


def test_serialize_roundtrip_model_only():
    algo = HoeffdingAlgo({})
    algo.learn_one(
        {"day_of_week": 1, "is_weekend": False, "days_since_start": 3, "is_post_drift": False,
         "tier": "urban", "recent_ctr": 0.02, "recent_visit_rate": 0.05, "win_rate_7d": 0.4},
        reward=1.5,
    )
    payload = serialize_model(algo._model)
    restored = deserialize_model(payload)
    assert restored is not None
    assert hasattr(restored, "predict_one")
