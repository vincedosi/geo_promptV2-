"""Accès Supabase côté Modal — réutilise le pattern A4.2 (HTTPS via supabase-py)."""
from __future__ import annotations

import os
from datetime import date, timedelta
from typing import Any

from supabase import Client, create_client


def get_client() -> Client:
    """Client Supabase authentifié avec service_role_key (secret Modal)."""
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url:
        raise EnvironmentError("SUPABASE_URL absent (secret Modal 'magelian-supabase').")
    if not key:
        raise EnvironmentError("SUPABASE_SERVICE_ROLE_KEY absent (secret Modal 'magelian-supabase').")
    return create_client(url, key)


def paginate_select(query_builder, page_size: int = 1000) -> list[dict[str, Any]]:
    """Récupère TOUS les résultats paginés (limite Supabase = 1000/appel)."""
    out: list[dict[str, Any]] = []
    offset = 0
    while True:
        rows = query_builder.range(offset, offset + page_size - 1).execute().data or []
        if not rows:
            break
        out.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size
    return out


def load_strategy(client: Client, strategy_id: str) -> dict[str, Any] | None:
    """Charge une stratégie + son objective associé + le flag is_demo de la campagne.

    Le flag `bidding_strategies.is_demo` peut être différent de
    `dsp_campaigns.is_demo`. C'est ce dernier qui détermine si on entraîne
    sur tout l'historique (campagne démo) ou sur une fenêtre récente
    (vraies campagnes en cours). Exposé via la clé `campaign_is_demo`.
    """
    resp = (
        client.table("bidding_strategies")
        .select("id,name,campaign_id,algorithm_code,objective_code,execution_mode,config,is_demo")
        .eq("id", strategy_id)
        .limit(1)
        .execute()
    )
    if not resp.data:
        return None
    strat = resp.data[0]
    obj_resp = (
        client.table("bidding_objectives")
        .select("optimization_direction,formula,required_metrics")
        .eq("code", strat["objective_code"])
        .limit(1)
        .execute()
    )
    obj = obj_resp.data[0] if obj_resp.data else {}
    camp_resp = (
        client.table("dsp_campaigns")
        .select("is_demo")
        .eq("id", strat["campaign_id"])
        .limit(1)
        .execute()
    )
    campaign_is_demo = bool(camp_resp.data[0]["is_demo"]) if camp_resp.data else False
    return {
        **strat,
        **{f"objective_{k}": v for k, v in obj.items()},
        "campaign_is_demo": campaign_is_demo,
    }


def load_active_model(client: Client, strategy_id: str) -> dict[str, Any] | None:
    """Charge la row adaptive_model_state active pour cette stratégie."""
    resp = (
        client.table("adaptive_model_state")
        .select("id,strategy_id,algorithm_code,model_version,parameters,hyperparameters,trained_at")
        .eq("strategy_id", strategy_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
    )
    return resp.data[0] if resp.data else None


def load_algorithm_meta(client: Client, code: str) -> dict[str, Any] | None:
    """Charge la row bidding_algorithms (config_schema, etc.) pour un code."""
    resp = (
        client.table("bidding_algorithms")
        .select("code,display_name,family,library,config_schema,is_baseline,is_enabled")
        .eq("code", code)
        .limit(1)
        .execute()
    )
    return resp.data[0] if resp.data else None


def load_recent_data(
    client: Client, campaign_id: str, days: int = 7, is_demo: bool = False
) -> list[dict[str, Any]]:
    """Charge les rows dsp_campaign_data pour cette campagne.

    - `is_demo=False` : filtre sur les `days` derniers jours (vraies campagnes
      en cours, où "récent" = pertinent pour le bidding live).
    - `is_demo=True`  : pas de filtre temporel, on charge tout l'historique
      du dataset démo (figé dans le passé, ex. mars 2026 — un filtre date
      basé sur `today` retournerait 0 ligne).

    Retourne une liste de dicts avec les champs nécessaires au build_context()
    (postal_code, country, date, impressions, clicks, spend, leads, visits,
    bid_requests, bid_won, tier).
    """
    query = (
        client.table("dsp_campaign_data")
        .select("date,postal_code,country,media,impressions,clicks,spend,metrics")
        .eq("campaign_id", campaign_id)
    )
    if not is_demo:
        since = (date.today() - timedelta(days=days)).isoformat()
        query = query.gte("date", since)
    return paginate_select(query.order("date").order("postal_code"))


def load_training_data(
    client: Client, campaign_id: str, days_back: int = 30, is_demo: bool = False
) -> list[dict[str, Any]]:
    """Charge la fenêtre d'entraînement (par défaut 30j) pour /train.

    Si `is_demo=True`, charge tout l'historique de la campagne (pas de filtre).
    """
    return load_recent_data(client, campaign_id, days=days_back, is_demo=is_demo)


def load_recent_daily_state(
    client: Client, strategy_id: str, lookback_days: int = 14
) -> list[dict[str, Any]]:
    """Charge bidding_daily_state pour scan de drift."""
    since = (date.today() - timedelta(days=lookback_days)).isoformat()
    rows = paginate_select(
        client.table("bidding_daily_state")
        .select("strategy_id,postal_code,country_code,date,applied_bid_multiplier,impressions,clicks,conversions,spend,revenue,metrics")
        .eq("strategy_id", strategy_id)
        .gte("date", since)
        .order("date")
    )
    return rows
