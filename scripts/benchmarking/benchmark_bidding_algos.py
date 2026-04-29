"""Orchestrateur du benchmark des 5 algos.

Pipeline :
  1. Charge les algos enabled + la stratégie démo + le dataset depuis Supabase
  2. Train/test split temporel : ≤ 21 mars / > 21 mars
  3. Pour chaque algo : instancie, entraîne sur train, évalue sur test
  4. Persiste 1 row adaptive_model_state par algo + 1 bidding_simulations
  5. Promote le gagnant (lift max) en is_active=true
  6. Génère le rapport markdown + 3 PNGs

Connexion Supabase via le JS Client (HTTPS port 443).

Usage :
  python benchmark_bidding_algos.py
"""
from __future__ import annotations

import os
import random
import sys
import time
from datetime import date
from pathlib import Path
from typing import Any

import numpy as np

# Imports locaux
sys.path.insert(0, str(Path(__file__).parent))
from data_loader import (  # noqa: E402
    get_client, load_algorithms, load_demo_strategy,
    load_demo_dataset, split_train_test, load_env,
)
from metrics import (  # noqa: E402
    train_algo, evaluate_on_test, baseline_metrics, lift_curve_daily,
)
from persistence import (  # noqa: E402
    reset_models_for_strategy, upsert_model_state,
    promote_winner, insert_simulation_summary,
)
from reporting import generate_all  # noqa: E402

# Algos
from algos.base import BiddingAlgorithm  # noqa: E402
from algos.hoeffding import HoeffdingAlgo  # noqa: E402
from algos.gbm_online import GbmOnlineAlgo  # noqa: E402
from algos.linucb import LinUcbAlgo  # noqa: E402
from algos.thompson import ThompsonAlgo  # noqa: E402
from algos.baseline_random import BaselineRandomAlgo  # noqa: E402


# Mapping code DB → classe Python. Ajouter un algo = ajouter une ligne.
ALGO_REGISTRY: dict[str, type[BiddingAlgorithm]] = {
    "hoeffding_adaptive_tree": HoeffdingAlgo,
    "gbm_online": GbmOnlineAlgo,
    "linucb": LinUcbAlgo,
    "thompson_sampling": ThompsonAlgo,
    "baseline_random": BaselineRandomAlgo,
}


TRAIN_END: date = date(2026, 3, 21)


def main() -> int:
    # Reproductibilité
    random.seed(42)
    np.random.seed(42)

    load_env()
    has_url = bool(
        os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
        or os.environ.get("SUPABASE_URL")
    )
    has_key = bool(os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))
    print(f"[benchmark] Supabase URL set: {has_url} | service_role key set: {has_key}")

    client = get_client()

    algos_meta = load_algorithms(client)
    strategy = load_demo_strategy(client)
    df = load_demo_dataset(client, strategy["campaign_id"])

    print(f"[benchmark] {len(algos_meta)} algos enabled, dataset = {len(df)} rows")
    print(f"[benchmark] strategy: {strategy['name']} (objective={strategy['objective_code']})")

    train_df, test_df = split_train_test(df, TRAIN_END)
    train_window = (train_df["date"].min(), train_df["date"].max())
    test_window = (test_df["date"].min(), test_df["date"].max())
    print(f"[benchmark] train: {train_window[0]}→{train_window[1]} ({len(train_df)} rows)")
    print(f"[benchmark] test : {test_window[0]}→{test_window[1]} ({len(test_df)} rows)")

    # Reset previous run
    reset_models_for_strategy(client, strategy["id"])

    results: list[dict[str, Any]] = []
    curves: dict[str, Any] = {}
    skipped: list[str] = []

    for meta in algos_meta:
        code = meta["code"]
        cls = ALGO_REGISTRY.get(code)
        if cls is None:
            print(f"[benchmark]  ⚠ {code}: pas d'implémentation Python, skip")
            skipped.append(code)
            continue
        print(f"[benchmark] ► running {code}")
        try:
            t_train_start = time.perf_counter()
            algo = cls(meta.get("config_schema") or {})
            train_ms = train_algo(algo, train_df)
            metrics, eval_ms = evaluate_on_test(algo, test_df)
            state = algo.get_state()
            model_id = upsert_model_state(
                client, strategy["id"], code, meta.get("config_schema") or {},
                state, metrics, (train_window[0], train_window[1]),
            )
            # Lift curve pour le plot — instancie une 2nde copie de l'algo
            # (la copie après évaluation a déjà appris sur le test, on repart)
            replay_algo = cls(meta.get("config_schema") or {})
            train_algo(replay_algo, train_df)
            curve = lift_curve_daily(replay_algo, test_df)
            curves[code] = curve

            duration = (time.perf_counter() - t_train_start) * 1000.0
            print(
                f"[benchmark]   {code}: lift={metrics['lift_pct']:+.2f}%, "
                f"cpl={metrics['cpl_sim']:.2f}€, total={duration:.0f}ms"
            )
            results.append({
                "code": code,
                "model_id": model_id,
                "metrics": metrics,
                "train_ms": train_ms,
                "eval_ms": eval_ms,
            })
        except Exception as exc:  # noqa: BLE001 — on log et continue
            print(f"[benchmark]   ✗ {code} échoué : {exc!r}")
            skipped.append(code)

    if not results:
        print("[benchmark] aucun algo n'a réussi — abort")
        return 1

    # Désigner le gagnant : max lift_pct (tie-break = min cpl_sim)
    winner = max(
        results,
        key=lambda r: (r["metrics"]["lift_pct"], -r["metrics"]["cpl_sim"]),
    )
    print(f"[benchmark] 🏆 winner: {winner['code']} (lift={winner['metrics']['lift_pct']:+.2f}%)")
    promote_winner(client, strategy["id"], winner["model_id"])

    # Résumé global
    baseline = baseline_metrics(test_df)
    winner_m = winner["metrics"]
    delta = {
        "lift_pct": winner_m["lift_pct"],
        "leads_delta": winner_m["leads_sim"] - baseline["leads"],
        "cpl_delta_eur": winner_m["cpl_sim"] - baseline["cpl_eur"],
    }
    # by_tier global = celui du gagnant
    insert_simulation_summary(
        client,
        strategy["id"],
        "Benchmark A4.2 — comparaison 5 algos",
        {
            "train_window": [str(train_window[0]), str(train_window[1])],
            "test_window": [str(test_window[0]), str(test_window[1])],
            "algos_compared": [r["code"] for r in results],
            "algos_skipped": skipped,
            "lambda": 1.0 / 12.5,
        },
        {"leads": baseline["leads"], "spend": baseline["spend"], "cpl_eur": baseline["cpl_eur"]},
        {"leads": winner_m["leads_sim"], "spend": winner_m["spend_sim"], "cpl_eur": winner_m["cpl_sim"], "code": winner["code"]},
        delta,
        winner_m["by_tier"],
    )

    # Rapport + plots
    paths = generate_all(
        results, curves, winner["code"], baseline, winner_m, train_window, test_window,
    )
    print(f"[benchmark] report: docs/chantier_a4_2_benchmark_results.md")
    for k, p in paths.items():
        print(f"[benchmark] plot {k}: {p}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
