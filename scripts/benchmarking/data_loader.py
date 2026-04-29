"""Charge dataset démo + algos + objectif depuis Supabase via le JS Client (HTTPS)."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any
from datetime import date

import pandas as pd
from dotenv import load_dotenv
from supabase import create_client, Client


# Source de vérité unique : .env.local à la racine du projet (convention Next.js).
# scripts/benchmarking/data_loader.py est 2 niveaux sous la racine.
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
ENV_LOCAL = PROJECT_ROOT / ".env.local"


def load_env() -> None:
    """Charge .env.local racine. Erreur explicite si absent."""
    if not ENV_LOCAL.exists():
        raise FileNotFoundError(
            f".env.local introuvable à {ENV_LOCAL}. "
            f"Le benchmark utilise les credentials du projet Next.js. "
            f"Voir scripts/benchmarking/README.md section 'Configuration env'."
        )
    load_dotenv(ENV_LOCAL, override=False)


# Mapping CP → tier (utilisé pour features). Aligné sur le seed du dataset démo.
_PREMIUM_URBAN = {
    '75001','75002','75003','75004','75005','75006','75007','75008',
    '75009','75010','75011','75016','75017',
}
_URBAN = {
    '69001','69002','69003','69006','69007',
    '13001','13002','13006','13008',
    '33000','33200','33300','59000','59800','59100',
}
_SUBURBAN = {
    '92100','92200','92300','92400','94200','94300','93100','93200',
    '78000','78100','91000','95100','95200','69100','69300','69500',
    '13100','13700','13800','33700','33600','59290','59650',
}


def infer_tier(postal_code: str) -> str:
    pc = (postal_code or "").strip()
    if pc in _PREMIUM_URBAN:
        return "premium_urban"
    if pc in _URBAN:
        return "urban"
    if pc in _SUBURBAN:
        return "suburban"
    return "rural"


def get_client() -> Client:
    """Retourne un client Supabase authentifié avec la service_role_key.

    Utilise les vars NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
    déjà présentes dans .env.local pour Next.js.

    Cette approche utilise HTTPS (port 443), donc fonctionne derrière les
    firewalls corporate qui bloquent les ports postgres (5432, 6543).
    """
    load_env()
    url = (
        os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
        or os.environ.get("SUPABASE_URL")
    )
    if not url:
        raise EnvironmentError(
            "Aucune URL Supabase trouvée. "
            "Vérifie que NEXT_PUBLIC_SUPABASE_URL est dans .env.local racine. "
            "Voir scripts/benchmarking/README.md section 'Configuration env'."
        )

    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise EnvironmentError(
            "SUPABASE_SERVICE_ROLE_KEY manquante dans .env.local. "
            "Cette clé est nécessaire pour INSERT/UPDATE sur adaptive_model_state. "
            "Récupère-la dans Supabase Dashboard → Settings → API → service_role key."
        )

    return create_client(url, key)


def paginate_select(query_builder, page_size: int = 1000) -> list[dict[str, Any]]:
    """Récupère TOUS les résultats en paginant via .range(start, end).

    Nécessaire car supabase-py limite à 1000 rows par appel par défaut. Le
    dataset démo fait 4078 lignes, donc on doit boucler.
    """
    all_rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        response = query_builder.range(offset, offset + page_size - 1).execute()
        rows = response.data or []
        if not rows:
            break
        all_rows.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size
    return all_rows


def load_algorithms(client: Client) -> list[dict[str, Any]]:
    """Retourne la liste des algos `is_enabled=true` ordonnés par display_order."""
    response = (
        client.table("bidding_algorithms")
        .select("code,display_name,family,library,config_schema,is_baseline")
        .eq("is_enabled", True)
        .order("display_order")
        .execute()
    )
    return list(response.data or [])


def load_demo_strategy(client: Client) -> dict[str, Any]:
    """Charge la stratégie démo (et son objective) depuis la base.

    Note : supabase-py ne supporte pas les JOIN inline natifs. On fait deux
    requêtes : d'abord la stratégie, puis l'objective associé.
    """
    strat_resp = (
        client.table("bidding_strategies")
        .select("id,name,campaign_id,objective_code,algorithm_code,created_at")
        .eq("is_demo", True)
        .order("created_at")
        .limit(1)
        .execute()
    )
    if not strat_resp.data:
        raise RuntimeError("Aucune stratégie démo trouvée (is_demo=true).")
    strat = strat_resp.data[0]

    obj_resp = (
        client.table("bidding_objectives")
        .select("optimization_direction,formula,required_metrics")
        .eq("code", strat["objective_code"])
        .limit(1)
        .execute()
    )
    if not obj_resp.data:
        raise RuntimeError(
            f"Objective '{strat['objective_code']}' introuvable pour la stratégie démo."
        )
    obj = obj_resp.data[0]

    # Conserve la même surface qu'avant le refacto.
    return {
        "id": strat["id"],
        "name": strat["name"],
        "campaign_id": strat["campaign_id"],
        "objective_code": strat["objective_code"],
        "algorithm_code": strat["algorithm_code"],
        "optimization_direction": obj["optimization_direction"],
        "formula": obj["formula"],
        "required_metrics": obj["required_metrics"],
    }


def load_demo_dataset(client: Client, campaign_id: str) -> pd.DataFrame:
    """Charge le dataset démo (~4078 lignes) en DataFrame trié par date+CP.

    supabase-py renvoie déjà les colonnes JSONB (`metrics`) sous forme de
    dict Python. On extrait les sous-champs en pandas plutôt qu'en SQL.
    """
    rows = paginate_select(
        client.table("dsp_campaign_data")
        .select("date,postal_code,country,media,impressions,clicks,spend,metrics")
        .eq("campaign_id", campaign_id)
        .order("date")
        .order("postal_code")
    )
    if not rows:
        raise RuntimeError(f"Dataset démo vide pour campaign_id={campaign_id}")

    df = pd.DataFrame(rows)

    # Extraction JSONB → colonnes scalaires (équivalent de COALESCE((metrics->>...)::int, 0))
    def _jsonb_int(metrics: Any, key: str) -> int:
        if not isinstance(metrics, dict):
            return 0
        v = metrics.get(key)
        if v is None or v == "":
            return 0
        try:
            return int(v)
        except (TypeError, ValueError):
            return 0

    def _jsonb_str(metrics: Any, key: str) -> str:
        if not isinstance(metrics, dict):
            return ""
        v = metrics.get(key)
        return "" if v is None else str(v)

    df["leads"] = df["metrics"].apply(lambda m: _jsonb_int(m, "leads"))
    df["visits"] = df["metrics"].apply(lambda m: _jsonb_int(m, "visits"))
    df["viewable_impressions"] = df["metrics"].apply(
        lambda m: _jsonb_int(m, "viewable_impressions")
    )
    df["bid_requests"] = df["metrics"].apply(lambda m: _jsonb_int(m, "bid_requests"))
    df["bid_won"] = df["metrics"].apply(lambda m: _jsonb_int(m, "bid_won"))
    df["tier_raw"] = df["metrics"].apply(lambda m: _jsonb_str(m, "tier"))
    df.drop(columns=["metrics"], inplace=True)

    # Normalisations (typage strict, alignées sur la version précédente)
    df["date"] = pd.to_datetime(df["date"]).dt.date
    df["impressions"] = df["impressions"].astype("int64")
    df["clicks"] = df["clicks"].astype("int64")
    df["spend"] = df["spend"].astype(float)
    df["leads"] = df["leads"].astype("int64")
    df["visits"] = df["visits"].astype("int64")
    df["viewable_impressions"] = df["viewable_impressions"].astype("int64")
    df["bid_requests"] = df["bid_requests"].astype("int64")
    df["bid_won"] = df["bid_won"].astype("int64")
    df["tier"] = df.apply(
        lambda r: r["tier_raw"] if r["tier_raw"] else infer_tier(r["postal_code"]),
        axis=1,
    )
    df.drop(columns=["tier_raw"], inplace=True)

    # Win rate rolling 7d par CP
    df.sort_values(["postal_code", "date"], inplace=True)
    df["win_rate_inst"] = df["bid_won"] / df["bid_requests"].replace(0, 1)
    df["win_rate_7d"] = (
        df.groupby("postal_code")["win_rate_inst"]
        .transform(lambda s: s.rolling(window=7, min_periods=1).mean())
    )
    df.drop(columns=["win_rate_inst"], inplace=True)
    df.sort_values(["date", "postal_code"], inplace=True)
    df.reset_index(drop=True, inplace=True)
    return df


def split_train_test(df: pd.DataFrame, train_end: date) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Split temporel : <= train_end → train, > train_end → test."""
    train = df[df["date"] <= train_end].copy()
    test = df[df["date"] > train_end].copy()
    return train, test


def build_context(row: pd.Series, day0: date) -> dict[str, Any]:
    """Conversion DataFrame row → dict context attendu par les algos."""
    d: date = row["date"]
    return {
        "postal_code": row["postal_code"],
        "date": d.isoformat(),
        "day_of_week": d.weekday(),
        "is_weekend": d.weekday() >= 5,
        "days_since_start": (d - day0).days,
        "is_post_drift": d >= date(2026, 3, 16),
        "tier": row["tier"],
        "recent_ctr": float(row["clicks"]) / max(int(row["impressions"]), 1),
        "recent_visit_rate": float(row["visits"]) / max(int(row["impressions"]), 1),
        "win_rate_7d": float(row["win_rate_7d"]),
    }
