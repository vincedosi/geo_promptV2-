"""Charge dataset démo + algos + objectif depuis Supabase."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any
from datetime import date

import pandas as pd
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv


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


def get_conn() -> psycopg2.extensions.connection:
    """Connexion psycopg2 robuste avec messages diagnostiques.

    Lit DATABASE_URL / POSTGRES_URL / SUPABASE_DB_URL depuis l'environnement
    (chargé depuis .env.local racine via load_env()). Timeout 10s pour éviter
    d'attendre 5 min sur un firewall.
    """
    load_env()
    db_url = (
        os.environ.get("DATABASE_URL")
        or os.environ.get("POSTGRES_URL")
        or os.environ.get("SUPABASE_DB_URL")
    )
    if not db_url:
        raise EnvironmentError(
            "Aucune URL de connexion DB trouvée dans .env.local. "
            "Ajoute DATABASE_URL=postgresql://postgres:PWD@db.<ref>.supabase.co:5432/postgres "
            "dans .env.local (Direct connection). "
            "Voir scripts/benchmarking/README.md section 'Configuration env'."
        )

    try:
        return psycopg2.connect(db_url, connect_timeout=10)
    except psycopg2.OperationalError as exc:
        msg = str(exc).lower()
        if ("tenant" in msg) or ("user" in msg and "not found" in msg):
            raise ConnectionError(
                "Erreur Supabase : tenant/user non trouvé.\n"
                "Tu utilises probablement le pooler avec un mauvais format d'username.\n"
                "→ Bascule sur la 'Direct connection' depuis le dashboard Supabase :\n"
                "   Settings → Database → Connection string → URI → Direct connection.\n"
                "   (host=db.<ref>.supabase.co:5432, username=postgres, sans suffixe)\n"
                f"\nDétail technique :\n{exc}"
            ) from exc
        if ("timed out" in msg) or ("could not connect" in msg) or ("could not translate" in msg):
            raise ConnectionError(
                "Connexion DB en timeout / DNS / network.\n"
                "Causes possibles :\n"
                "  1. IP non whitelistée → Supabase Dashboard → Settings → Database → Network restrictions\n"
                "  2. Firewall Dentsu bloque le port 5432 → essayer le transaction pooler port 6543\n"
                "     (host=aws-0-eu-west-3.pooler.supabase.com, username=postgres.<ref>)\n"
                "  3. VPN d'entreprise filtre les connexions DB → se déconnecter du VPN\n"
                f"\nDétail technique :\n{exc}"
            ) from exc
        if "password" in msg or "authentication" in msg:
            raise ConnectionError(
                "Erreur d'authentification DB.\n"
                "Causes possibles :\n"
                "  1. Mot de passe DB incorrect dans DATABASE_URL\n"
                "  2. Caractères spéciaux non URL-encodés (encoder @=%40, #=%23, &=%26, /=%2F, etc.)\n"
                "  3. Mot de passe a été reset depuis le dashboard Supabase\n"
                f"\nDétail technique :\n{exc}"
            ) from exc
        raise ConnectionError(
            f"Erreur de connexion DB inconnue. Vérifie DATABASE_URL.\n\nDétail :\n{exc}"
        ) from exc


def load_algorithms(conn) -> list[dict[str, Any]]:
    """Retourne la liste des algos `is_enabled=true` ordonnés par display_order."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT code, display_name, family, library, config_schema, is_baseline
            FROM bidding_algorithms
            WHERE is_enabled = true
            ORDER BY display_order
            """
        )
        return [dict(row) for row in cur.fetchall()]


def load_demo_strategy(conn) -> dict[str, Any]:
    """Charge la stratégie démo (et son objective) depuis la base."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT bs.id, bs.name, bs.campaign_id, bs.objective_code, bs.algorithm_code,
                   bo.optimization_direction, bo.formula, bo.required_metrics
            FROM bidding_strategies bs
            JOIN bidding_objectives bo ON bo.code = bs.objective_code
            WHERE bs.is_demo = true
            ORDER BY bs.created_at
            LIMIT 1
            """
        )
        row = cur.fetchone()
        if not row:
            raise RuntimeError("Aucune stratégie démo trouvée (is_demo=true).")
        return dict(row)


def load_demo_dataset(conn, campaign_id: str) -> pd.DataFrame:
    """Charge le dataset démo (4078 lignes) en DataFrame trié par date+CP."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT date, postal_code, country, media,
                   impressions, clicks, spend,
                   COALESCE((metrics->>'leads')::int, 0)                AS leads,
                   COALESCE((metrics->>'visits')::int, 0)               AS visits,
                   COALESCE((metrics->>'viewable_impressions')::bigint, 0) AS viewable_impressions,
                   COALESCE((metrics->>'bid_requests')::bigint, 0)      AS bid_requests,
                   COALESCE((metrics->>'bid_won')::bigint, 0)           AS bid_won,
                   COALESCE(metrics->>'tier', '')                       AS tier_raw
            FROM dsp_campaign_data
            WHERE campaign_id = %s
            ORDER BY date, postal_code
            """,
            (campaign_id,),
        )
        rows = [dict(r) for r in cur.fetchall()]

    df = pd.DataFrame(rows)
    if df.empty:
        raise RuntimeError(f"Dataset démo vide pour campaign_id={campaign_id}")

    # Normalisations
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
