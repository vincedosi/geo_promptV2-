"""Persistance des résultats benchmark en base."""
from __future__ import annotations

import json
from datetime import date
from typing import Any


MODEL_VERSION_PREFIX = "0.1.0-benchmark-"


def reset_models_for_strategy(conn, strategy_id: str) -> None:
    """Mark all existing models for this strategy as inactive (re-run safe)."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE adaptive_model_state SET is_active = false, retired_at = NOW() "
            "WHERE strategy_id = %s AND is_active = true",
            (strategy_id,),
        )


def upsert_model_state(
    conn,
    strategy_id: str,
    algo_code: str,
    config_schema: dict[str, Any],
    state: dict[str, Any],
    performance_metrics: dict[str, Any],
    train_window: tuple[date, date],
) -> str:
    """Insert (or replace) un row adaptive_model_state pour cet algo.

    Retourne l'`id` (UUID) du row créé/mis à jour. Le partial unique index
    `idx_ams_one_active` garantit qu'un seul `is_active=true` est possible
    par stratégie.
    """
    version = f"{MODEL_VERSION_PREFIX}{algo_code}"
    with conn.cursor() as cur:
        # Cleanup éventuelle row précédente même version (re-run)
        cur.execute(
            "DELETE FROM adaptive_model_state "
            "WHERE strategy_id = %s AND model_version = %s",
            (strategy_id, version),
        )
        cur.execute(
            """
            INSERT INTO adaptive_model_state
              (strategy_id, algorithm_code, model_version,
               parameters, hyperparameters,
               training_window_start, training_window_end,
               performance_metrics,
               is_active, trained_at)
            VALUES (%s, %s, %s, %s::jsonb, %s::jsonb, %s, %s, %s::jsonb, false, NOW())
            RETURNING id
            """,
            (
                strategy_id, algo_code, version,
                json.dumps(state, default=str),
                json.dumps(config_schema or {}, default=str),
                train_window[0], train_window[1],
                json.dumps(performance_metrics, default=str),
            ),
        )
        row = cur.fetchone()
        return str(row[0])


def promote_winner(conn, strategy_id: str, model_id: str) -> None:
    """Mark the given model as `is_active=true`."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE adaptive_model_state SET is_active = true, promoted_at = NOW() "
            "WHERE id = %s AND strategy_id = %s",
            (model_id, strategy_id),
        )


def insert_simulation_summary(
    conn,
    strategy_id: str,
    name: str,
    parameters: dict[str, Any],
    baseline: dict[str, Any],
    winner: dict[str, Any],
    delta: dict[str, Any],
    by_tier: dict[str, Any],
) -> str:
    """Insert le résumé global du benchmark dans bidding_simulations."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO bidding_simulations
              (strategy_id, name, parameters,
               baseline_metrics, simulated_metrics, delta, zone_results,
               status, started_at, completed_at)
            VALUES (%s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb,
                    'completed', NOW(), NOW())
            RETURNING id
            """,
            (
                strategy_id, name,
                json.dumps(parameters, default=str),
                json.dumps(baseline, default=str),
                json.dumps(winner, default=str),
                json.dumps(delta, default=str),
                json.dumps(by_tier, default=str),
            ),
        )
        return str(cur.fetchone()[0])


def update_strategy_winner(conn, strategy_id: str, winner_code: str) -> None:
    """Update bidding_strategies.algorithm_code to the winner if changed."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE bidding_strategies SET algorithm_code = %s WHERE id = %s",
            (winner_code, strategy_id),
        )
