#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MAGELIAN — Score d'alignement géographique sur campagnes Adform (test offline).

Lit les fichiers .xlsx/.xls/.csv d'un dossier (onglet `Sheet`), matche les
postal_code aux IRIS via `postal_code_commune` + table `iris`, distribue les
impressions au prorata de la population IRIS dans la commune, puis calcule un
score d'alignement pondéré sur une cible socio-démo choisie via menu interactif.

Usage:
    python scripts/scoring/geo_alignment.py
    python scripts/scoring/geo_alignment.py --target-cols pop_18_24
    python scripts/scoring/geo_alignment.py --target-cols pop_15_29,pop_30_44 \
        --input "C:\\GENESIS\\genesis_app\\TEST" \
        --output "C:\\GENESIS\\genesis_app\\TEST\\_output"
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import warnings
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client, Client

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

warnings.filterwarnings("ignore", category=UserWarning, module="openpyxl")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("geo_alignment")

DEFAULT_INPUT = Path(__file__).resolve().parents[2] / "TEST"  # racine repo / TEST
DEFAULT_MIN_POPULATION = 200  # exclut les IRIS à très faible pop (outliers d'affinity)
SHEET_NAME = "Sheet"
EXPECTED_HEADERS = [
    "Campaign", "Media", "City", "Country", "DMA region",
    "Postal Code", "Region", "Tracked Ads", "Unique Reach",
]
HEADER_TO_FIELD = {
    "Campaign": "campaign_name",
    "Media": "media_source",
    "City": "city",
    "Country": "country",
    "DMA region": "dma_region",
    "Postal Code": "postal_code",
    "Region": "region",
    "Tracked Ads": "tracked_ads",
    "Unique Reach": "unique_reach",
}
DENOMINATOR_CANDIDATES = ["pop_totale", "pop_total", "population", "pop_15_plus"]
TECHNICAL_PREFIXES = ("code_", "nom_", "is_")
TECHNICAL_NAMES = {"id", "created_at", "updated_at"}
TECHNICAL_SUFFIXES = ("_id",)

# Référentiel INSEE stable — codes département → nom (métropole + Corse + DOM)
DEPT_NAMES: dict[str, str] = {
    "01": "Ain", "02": "Aisne", "03": "Allier", "04": "Alpes-de-Haute-Provence",
    "05": "Hautes-Alpes", "06": "Alpes-Maritimes", "07": "Ardèche", "08": "Ardennes",
    "09": "Ariège", "10": "Aube", "11": "Aude", "12": "Aveyron", "13": "Bouches-du-Rhône",
    "14": "Calvados", "15": "Cantal", "16": "Charente", "17": "Charente-Maritime",
    "18": "Cher", "19": "Corrèze", "21": "Côte-d'Or", "22": "Côtes-d'Armor",
    "23": "Creuse", "24": "Dordogne", "25": "Doubs", "26": "Drôme", "27": "Eure",
    "28": "Eure-et-Loir", "29": "Finistère", "2A": "Corse-du-Sud", "2B": "Haute-Corse",
    "30": "Gard", "31": "Haute-Garonne", "32": "Gers", "33": "Gironde", "34": "Hérault",
    "35": "Ille-et-Vilaine", "36": "Indre", "37": "Indre-et-Loire", "38": "Isère",
    "39": "Jura", "40": "Landes", "41": "Loir-et-Cher", "42": "Loire", "43": "Haute-Loire",
    "44": "Loire-Atlantique", "45": "Loiret", "46": "Lot", "47": "Lot-et-Garonne",
    "48": "Lozère", "49": "Maine-et-Loire", "50": "Manche", "51": "Marne",
    "52": "Haute-Marne", "53": "Mayenne", "54": "Meurthe-et-Moselle", "55": "Meuse",
    "56": "Morbihan", "57": "Moselle", "58": "Nièvre", "59": "Nord", "60": "Oise",
    "61": "Orne", "62": "Pas-de-Calais", "63": "Puy-de-Dôme", "64": "Pyrénées-Atlantiques",
    "65": "Hautes-Pyrénées", "66": "Pyrénées-Orientales", "67": "Bas-Rhin",
    "68": "Haut-Rhin", "69": "Rhône", "70": "Haute-Saône", "71": "Saône-et-Loire",
    "72": "Sarthe", "73": "Savoie", "74": "Haute-Savoie", "75": "Paris",
    "76": "Seine-Maritime", "77": "Seine-et-Marne", "78": "Yvelines", "79": "Deux-Sèvres",
    "80": "Somme", "81": "Tarn", "82": "Tarn-et-Garonne", "83": "Var", "84": "Vaucluse",
    "85": "Vendée", "86": "Vienne", "87": "Haute-Vienne", "88": "Vosges", "89": "Yonne",
    "90": "Territoire de Belfort", "91": "Essonne", "92": "Hauts-de-Seine",
    "93": "Seine-Saint-Denis", "94": "Val-de-Marne", "95": "Val-d'Oise",
    "971": "Guadeloupe", "972": "Martinique", "973": "Guyane", "974": "La Réunion",
    "976": "Mayotte",
}


def derive_code_departement(code_commune: Any) -> str | None:
    """code_commune INSEE → code_departement (Corse 2A/2B, DOM 97x/98x, métropole 2 chiffres)."""
    if code_commune is None or (isinstance(code_commune, float) and np.isnan(code_commune)):
        return None
    s = str(code_commune).strip()
    if not s:
        return None
    if s[:2] in ("2A", "2B"):
        return s[:2]
    if s.startswith(("97", "98")) and len(s) >= 3:
        return s[:3]
    return s[:2] if len(s) >= 2 else None


# ─────────────────────────────────────────────────────────────────────────────
# DB — client Supabase HTTPS + RPCs (geo_alignment_*)
# ─────────────────────────────────────────────────────────────────────────────

POSTAL_BATCH_SIZE = 50  # ~17 IRIS/postal en moyenne → ~850 rows/batch, sous la limite PostgREST


def connect_db() -> Client:
    load_dotenv(Path(__file__).resolve().parents[2] / ".env.local")
    load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
           or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY"))
    if not url or not key:
        log.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absent du .env.local")
        sys.exit(2)
    try:
        return create_client(url, key)
    except Exception as e:
        log.error("Init client Supabase impossible : %s", e)
        sys.exit(2)


# ─────────────────────────────────────────────────────────────────────────────
# Scan + load
# ─────────────────────────────────────────────────────────────────────────────

def scan_files(input_dir: Path) -> list[Path]:
    if not input_dir.is_dir():
        log.error("Dossier input introuvable : %s", input_dir)
        sys.exit(2)
    out: list[Path] = []
    for p in sorted(input_dir.iterdir()):
        if p.is_dir():
            continue
        if p.name.startswith(".") or p.name.startswith("_"):
            continue
        if p.suffix.lower() in {".xlsx", ".xls", ".csv"}:
            out.append(p)
    return out


def _clean_thousands(value: Any) -> int | None:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    if isinstance(value, (int, np.integer)):
        return int(value)
    if isinstance(value, float):  # NaN déjà écarté par le garde en tête de fonction
        return int(round(value))
    s = str(value).strip().replace(" ", "").replace(" ", "")
    if not s or s.lower() in {"nan", "none", "-"}:
        return None
    try:
        return int(round(float(s.replace(",", "."))))
    except ValueError:
        return None


def _coerce_postal(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, float):
        if np.isnan(value):
            return None
        # Excel peut stocker un code postal en float (60220.0)
        s = str(int(round(value)))
    else:
        s = str(value)
    s = s.strip()
    if not s or s.lower() in {"nan", "none"}:
        return None
    # Codes postaux français : 5 chiffres (préserver le 0 leading)
    if s.isdigit() and len(s) <= 5:
        s = s.zfill(5)
    return s


def load_excel_sheet(path: Path) -> pd.DataFrame | None:
    """Lit l'onglet `Sheet` d'un fichier xlsx/xls. Retourne None si absent."""
    try:
        xl = pd.ExcelFile(path)
    except Exception as e:
        log.warning("Lecture impossible (%s) : %s", path.name, e)
        return None
    if SHEET_NAME not in xl.sheet_names:
        log.warning("Onglet `%s` manquant dans %s — fichier ignoré", SHEET_NAME, path.name)
        return None
    df = xl.parse(
        SHEET_NAME,
        dtype={"Postal Code": str},  # forcer string
        keep_default_na=True,
    )
    return df


def load_csv(path: Path) -> pd.DataFrame:
    # Tente plusieurs séparateurs / encodages — Adform exporte parfois en ; latin-1
    for sep in (",", ";", "\t"):
        for enc in ("utf-8", "utf-8-sig", "latin-1"):
            try:
                df = pd.read_csv(path, sep=sep, encoding=enc, dtype={"Postal Code": str})
                if df.shape[1] >= 5:
                    return df
            except Exception:
                continue
    raise RuntimeError(f"CSV illisible : {path.name}")


def normalize_dataframe(df: pd.DataFrame, source_file: str) -> pd.DataFrame:
    df = df.rename(columns=lambda c: str(c).strip())

    missing = [h for h in EXPECTED_HEADERS if h not in df.columns]
    if missing:
        log.warning("Colonnes manquantes dans %s : %s — fichier ignoré", source_file, missing)
        return pd.DataFrame()

    df = df[EXPECTED_HEADERS].copy()
    df.columns = [HEADER_TO_FIELD[h] for h in EXPECTED_HEADERS]

    # Strings
    for col in ("campaign_name", "media_source", "city", "country", "dma_region", "region"):
        df[col] = df[col].apply(lambda v: None if pd.isna(v) else str(v).strip())

    df["postal_code"] = df["postal_code"].apply(_coerce_postal)
    df["tracked_ads"] = df["tracked_ads"].apply(_clean_thousands)
    df["unique_reach"] = df["unique_reach"].apply(_clean_thousands)

    df["source_file"] = source_file
    return df


def load_all_files(files: list[Path]) -> tuple[pd.DataFrame, dict[str, int]]:
    frames: list[pd.DataFrame] = []
    stats = {"detected": len(files), "loaded": 0, "errors": 0, "rows_total": 0}
    for path in files:
        log.info("→ Chargement %s", path.name)
        try:
            if path.suffix.lower() == ".csv":
                raw = load_csv(path)
            else:
                raw = load_excel_sheet(path)
            if raw is None:
                stats["errors"] += 1
                continue
            df = normalize_dataframe(raw, path.name)
            if df.empty:
                stats["errors"] += 1
                continue
            stats["loaded"] += 1
            stats["rows_total"] += len(df)
            log.info("  %d lignes brutes", len(df))
            frames.append(df)
        except Exception as e:
            log.warning("Erreur sur %s : %s", path.name, e)
            stats["errors"] += 1
    if not frames:
        return pd.DataFrame(), stats
    return pd.concat(frames, ignore_index=True), stats


def filter_france(df: pd.DataFrame) -> pd.DataFrame:
    before = len(df)
    df = df[df["country"].str.casefold() == "france"].copy()
    df = df[df["postal_code"].notna()].copy()
    df = df[df["tracked_ads"].notna()].copy()
    df["tracked_ads"] = df["tracked_ads"].astype(int)
    df["unique_reach"] = df["unique_reach"].fillna(0).astype(int)
    log.info("Filtre France + postal_code : %d → %d lignes", before, len(df))
    return df


# ─────────────────────────────────────────────────────────────────────────────
# Découverte colonnes IRIS
# ─────────────────────────────────────────────────────────────────────────────

NUMERIC_TYPES = {
    "integer", "bigint", "smallint",
    "numeric", "double precision", "real",
}


def discover_iris_columns(client: Client) -> list[str]:
    """RPC geo_alignment_numeric_columns → liste filtrée côté serveur."""
    try:
        resp = client.rpc("geo_alignment_numeric_columns", {}).execute()
    except Exception as e:
        log.error("RPC geo_alignment_numeric_columns en échec : %s", e)
        sys.exit(2)
    rows = resp.data or []
    candidates: list[str] = []
    for row in rows:
        name = row.get("column_name")
        if not name:
            continue
        # Double sécurité côté client (la RPC filtre déjà).
        if name in TECHNICAL_NAMES:
            continue
        if any(name.startswith(pfx) for pfx in TECHNICAL_PREFIXES):
            continue
        if any(name.endswith(sfx) for sfx in TECHNICAL_SUFFIXES):
            continue
        candidates.append(name)
    return candidates


def group_columns(cols: list[str]) -> list[tuple[str, list[str]]]:
    groups: dict[str, list[str]] = defaultdict(list)
    for c in cols:
        if c.startswith("pop_") or c == "population":
            groups["Tranches d'âge / Population"].append(c)
        elif "csp" in c or c.startswith("cs_"):
            groups["CSP"].append(c)
        elif "menage" in c or c.startswith("men_"):
            groups["Ménages"].append(c)
        elif c.startswith("rev_"):
            groups["Revenus"].append(c)
        elif "diplome" in c:
            groups["Diplômes"].append(c)
        elif c.startswith("taux_"):
            groups["Taux"].append(c)
        elif c.startswith("part_"):
            groups["Parts (part_*)"].append(c)
        else:
            groups["Divers"].append(c)
    order = [
        "Tranches d'âge / Population", "CSP", "Ménages", "Revenus",
        "Diplômes", "Taux", "Parts (part_*)", "Divers",
    ]
    return [(g, sorted(groups[g])) for g in order if groups.get(g)]


def detect_denominator(cols: list[str], override: str | None) -> str:
    if override:
        if override not in cols:
            log.error("Colonne denominator `%s` introuvable. Disponibles : %s",
                      override, ", ".join(cols))
            sys.exit(2)
        return override
    for c in DENOMINATOR_CANDIDATES:
        if c in cols:
            return c
    # fallback : demander à l'utilisateur
    log.warning("Aucun candidat denominator standard trouvé. Choisis manuellement :")
    candidates = [c for c in cols if c.startswith("pop") or c == "population"]
    if not candidates:
        log.error("Aucune colonne population trouvée. Abort.")
        sys.exit(2)
    for i, c in enumerate(candidates, 1):
        print(f"  [{i}] {c}")
    while True:
        raw = input("> ").strip()
        if not raw:
            continue
        try:
            idx = int(raw) - 1
            return candidates[idx]
        except (ValueError, IndexError):
            print("Saisie invalide, recommence.")


# ─────────────────────────────────────────────────────────────────────────────
# Menu interactif
# ─────────────────────────────────────────────────────────────────────────────

def print_menu(grouped: list[tuple[str, list[str]]]) -> dict[int, str]:
    print()
    print("🎯 Sélection de la cible socio-démo")
    print()
    idx_to_col: dict[int, str] = {}
    n = 0
    for group_name, cols in grouped:
        print(f"  {group_name}")
        for c in cols:
            n += 1
            idx_to_col[n] = c
            print(f"  [{n:>3}]  {c}")
        print()
    return idx_to_col


def parse_user_input(raw: str, idx_to_col: dict[int, str]) -> list[str] | None:
    raw = raw.strip()
    if not raw:
        return None
    if raw.lower() in {"q", "quit", "exit"}:
        print("Bye.")
        sys.exit(0)
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    out: list[str] = []
    for p in parts:
        if not p.isdigit():
            print(f"  ✗ Saisie invalide : `{p}` (attendu : numéro)")
            return None
        idx = int(p)
        if idx not in idx_to_col:
            print(f"  ✗ Numéro hors plage : {idx}")
            return None
        col = idx_to_col[idx]
        if col not in out:
            out.append(col)
    return out or None


def select_target_interactive(
    cols: list[str], denominator_override: str | None,
) -> tuple[list[str], str, str]:
    grouped = group_columns(cols)
    while True:
        idx_to_col = print_menu(grouped)
        print("> Ton choix (numéro, ou plusieurs séparés par virgule pour sommer) : ", end="", flush=True)
        try:
            raw = input()
        except (EOFError, KeyboardInterrupt):
            print()
            sys.exit(0)
        target_cols = parse_user_input(raw, idx_to_col)
        if not target_cols:
            print("  ✗ Aucune cible valide. Recommence.")
            continue

        denominator = detect_denominator(cols, denominator_override)
        target_label = "+".join(target_cols)
        print()
        print("✅ Cible sélectionnée :")
        print(f"   Numérateur     : {target_label}")
        print(f"   Dénominateur   : {denominator} (auto-détecté)")
        print()
        ans = input("Confirmer ? [O/n] : ").strip().lower()
        if ans in ("", "o", "oui", "y", "yes"):
            return target_cols, denominator, target_label
        # sinon : retour menu


def select_target_cli(
    target_cols_raw: str, cols: list[str], denominator_override: str | None,
) -> tuple[list[str], str, str]:
    target_cols = [c.strip() for c in target_cols_raw.split(",") if c.strip()]
    unknown = [c for c in target_cols if c not in cols]
    if unknown:
        log.error("Colonnes target introuvables : %s", unknown)
        log.info("Colonnes disponibles (extrait) : %s", ", ".join(cols[:30]))
        sys.exit(2)
    denominator = detect_denominator(cols, denominator_override)
    target_label = "+".join(target_cols)
    return target_cols, denominator, target_label


# ─────────────────────────────────────────────────────────────────────────────
# Baseline + matching
# ─────────────────────────────────────────────────────────────────────────────

def fetch_baseline(
    client: Client,
    target_cols: list[str],
    denominator: str,
    min_population: int = DEFAULT_MIN_POPULATION,
) -> tuple[float, float, float]:
    """
    RPC geo_alignment_baseline → (baseline_ratio, sum_target_FR, sum_denom_FR).
    Filtre `is_true_iris=true AND population >= min_population` côté serveur.
    """
    try:
        resp = client.rpc(
            "geo_alignment_baseline",
            {
                "p_target_cols": target_cols,
                "p_denominator": denominator,
                "p_min_population": float(min_population),
            },
        ).execute()
    except Exception as e:
        log.error("RPC geo_alignment_baseline en échec : %s", e)
        raise
    rows = resp.data or []
    if not rows:
        raise RuntimeError("Baseline vide — RPC n'a rien retourné.")
    row = rows[0]
    sum_target = float(row.get("sum_target") or 0)
    sum_denom = float(row.get("sum_denom") or 0)
    if sum_denom == 0:
        raise RuntimeError("Dénominateur national nul — impossible de calculer le baseline.")
    return sum_target / sum_denom, sum_target, sum_denom


def fetch_postal_to_iris(
    client: Client,
    postal_codes: list[str],
    target_cols: list[str],
    denominator: str,
) -> pd.DataFrame:
    """
    RPC geo_alignment_match_postals — batché pour rester sous la limite PostgREST.
    Retourne pour chaque (postal_code, IRIS de la commune) :
      share, target_value, denom_value, nom_commune, code_commune, is_true_iris.
    """
    if not postal_codes:
        return pd.DataFrame()
    uniq = sorted({p for p in postal_codes if p})
    chunks: list[list[dict]] = []
    n_batches = (len(uniq) + POSTAL_BATCH_SIZE - 1) // POSTAL_BATCH_SIZE
    matched_postals = 0
    for i in range(0, len(uniq), POSTAL_BATCH_SIZE):
        batch_idx = i // POSTAL_BATCH_SIZE + 1
        batch = uniq[i:i + POSTAL_BATCH_SIZE]
        try:
            resp = client.rpc(
                "geo_alignment_match_postals",
                {
                    "p_postal_codes": batch,
                    "p_target_cols": target_cols,
                    "p_denominator": denominator,
                },
            ).execute()
        except Exception as e:
            log.error("RPC geo_alignment_match_postals (batch %d) en échec : %s",
                      batch_idx, e)
            sys.exit(2)
        rows = resp.data or []
        chunks.extend(rows)
        matched_postals += len({r.get("postal_code") for r in rows if r.get("postal_code")})
        if batch_idx == 1 or batch_idx % 10 == 0 or batch_idx == n_batches:
            log.info("   batch %d/%d : %d postals OK, %d IRIS rows cumulés",
                     batch_idx, n_batches, matched_postals, len(chunks))
    if not chunks:
        return pd.DataFrame()
    df = pd.DataFrame(chunks)
    # Sécurité : la RPC fournit déjà le fallback équi-réparti quand pop_iris=0,
    # mais si NaN persiste, on rééquilibre côté client.
    if "share" in df.columns and df["share"].isna().any():
        counts = df.groupby("postal_code")["code_iris"].transform("count")
        df["share"] = df["share"].fillna(1.0 / counts)
    for col in ("target_value", "denom_value", "share"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# Calculs
# ─────────────────────────────────────────────────────────────────────────────

def gini(values: np.ndarray) -> float:
    """Indice de Gini sur une distribution non négative."""
    v = np.asarray(values, dtype=float)
    v = v[~np.isnan(v)]
    v = v[v >= 0]
    if v.size == 0 or v.sum() == 0:
        return 0.0
    v = np.sort(v)
    n = v.size
    cum = np.cumsum(v)
    return float((n + 1 - 2 * cum.sum() / cum[-1]) / n)


def top_n_iris(
    df_camp: pd.DataFrame, *, kind: str, n: int = 3,
) -> list[dict[str, Any]]:
    """
    kind = 'overdelivered'  → faible affinity (<80) + grosse livraison
    kind = 'underdelivered' → forte affinity (>=120) + faible livraison
    kind = 'strong'         → forte affinity (>=120) + grosse livraison
    """
    if df_camp.empty:
        return []
    total_imp = df_camp["imp"].sum()
    if total_imp <= 0:
        return []
    if kind == "overdelivered":
        sub = df_camp[df_camp["affinity"] < 80].sort_values("imp", ascending=False)
    elif kind == "underdelivered":
        sub = df_camp[df_camp["affinity"] >= 120].sort_values("imp", ascending=True)
    elif kind == "strong":
        sub = df_camp[df_camp["affinity"] >= 120].sort_values("imp", ascending=False)
    else:
        return []
    sub = sub.head(n)
    out = []
    for _, r in sub.iterrows():
        out.append({
            "code_iris": str(r["code_iris"]),
            "ville": (r.get("nom_commune") or ""),
            "affinity": round(float(r["affinity"]), 1),
            "imp": int(round(float(r["imp"]))),
            "share_pct": round(float(r["imp"]) / total_imp * 100, 2),
        })
    return out


def compute_affinity(
    df_full: pd.DataFrame,
    baseline: float,
    min_population: int = DEFAULT_MIN_POPULATION,
) -> pd.DataFrame:
    """
    Ajoute la colonne `affinity` (en place + retour) sur un DataFrame contenant
    `target_value`, `denom_value`. Applique le filtre `min_population` :
    les IRIS dont denom_value < min_population sont marqués `affinity=NaN`
    (donc exclus du calcul du score sans perdre la trace).
    """
    safe_denom = df_full["denom_value"].where(df_full["denom_value"] > 0)
    ratio_iris = df_full["target_value"] / safe_denom
    df_full["affinity"] = (ratio_iris / baseline) * 100
    if min_population and min_population > 0:
        below = df_full["denom_value"] < min_population
        df_full.loc[below, "affinity"] = np.nan
    return df_full


def _weighted_score(df: pd.DataFrame) -> tuple[float, float]:
    """Score d'alignement pondéré par les impressions sur les IRIS à affinity
    calculable (affinity NON-NaN = denom_value >= min_population).
    Retourne (score, scorable_imp). score = NaN si aucune impression scorable."""
    scorable = df[df["affinity"].notna()]
    scorable_imp = float(scorable["imp"].sum())
    if scorable_imp <= 0:
        return float("nan"), scorable_imp
    return float((scorable["imp"] * scorable["affinity"]).sum() / scorable_imp), scorable_imp


def _band_imp(per_iris: pd.DataFrame) -> tuple[float, float, float]:
    """Répartit les impressions par bande d'affinity sur les IRIS à affinity valide.
    Retourne (on_target >= 120, neutral 80-120, off_target < 80)."""
    band = per_iris[per_iris["affinity"].notna()]
    on_target = float(band.loc[band["affinity"] >= 120, "imp"].sum())
    neutral = float(band.loc[(band["affinity"] >= 80) & (band["affinity"] < 120), "imp"].sum())
    off_target = float(band.loc[band["affinity"] < 80, "imp"].sum())
    return on_target, neutral, off_target


def compute_campaign_metrics(
    df_full: pd.DataFrame,
    baseline: float,
    min_population: int = DEFAULT_MIN_POPULATION,
) -> pd.DataFrame:
    """
    df_full attendu (1 ligne par campagne × IRIS × source_file):
      source_file, campaign_name, media_source, code_iris, nom_commune,
      imp (= tracked_ads × share), target_value, denom_value, matched (bool)
    """
    df_full = compute_affinity(df_full, baseline, min_population=min_population)
    # Pour les agrégats : on traite NaN comme "exclu" (faible pop) plutôt que 0
    df_full["affinity_clean"] = df_full["affinity"]

    rows = []
    for (source_file, campaign_name), gp in df_full.groupby(
        ["source_file", "campaign_name"], dropna=False, sort=False,
    ):
        total_imp = gp["imp"].sum()
        matched = gp[gp["matched"]]
        matched_imp = matched["imp"].sum()

        # Score pondéré sur les IRIS à affinity calculable (denom >= min_population)
        score, scorable_imp = _weighted_score(matched)

        # Pour les % on / nb_iris_touched : on agrège matched par (code_iris)
        per_iris = matched.groupby("code_iris", as_index=False).agg(
            imp=("imp", "sum"),
            affinity=("affinity", "first"),
            nom_commune=("nom_commune", "first"),
        )
        on_target_imp, neutral_imp, off_target_imp = _band_imp(per_iris)

        pct = lambda v: v / scorable_imp * 100 if scorable_imp > 0 else 0.0

        media_source = "|".join(sorted({m for m in gp["media_source"].dropna().unique()}))
        unique_reach_total = int(gp["unique_reach_row"].sum())
        nb_postal = int(gp["postal_code"].nunique())
        nb_iris = int(per_iris.shape[0])
        gini_val = gini(per_iris["imp"].values)

        rows.append({
            "source_file": source_file,
            "campaign_name": campaign_name,
            "media_source": media_source,
            "total_impressions": int(round(total_imp)),
            "total_unique_reach": unique_reach_total,
            "nb_postal_codes": nb_postal,
            "nb_iris_touched": nb_iris,
            "iris_match_rate": round(matched_imp / total_imp * 100, 2) if total_imp > 0 else 0.0,
            "score_alignment": round(score, 2) if not pd.isna(score) else None,
            "pct_imp_on_target": round(pct(on_target_imp), 2),
            "pct_imp_neutral": round(pct(neutral_imp), 2),
            "pct_imp_off_target": round(pct(off_target_imp), 2),
            "gini_concentration": round(gini_val, 4),
            "top3_overdelivered_iris": json.dumps(
                top_n_iris(per_iris, kind="overdelivered"), ensure_ascii=False),
            "top3_underdelivered_iris": json.dumps(
                top_n_iris(per_iris, kind="underdelivered"), ensure_ascii=False),
            "top3_strong_iris": json.dumps(
                top_n_iris(per_iris, kind="strong"), ensure_ascii=False),
            "_per_iris_internal": per_iris,  # consommé plus bas pour le résumé
        })
    return pd.DataFrame(rows)


def compute_department_metrics(
    df_full: pd.DataFrame,
    baseline: float,
    min_population: int = DEFAULT_MIN_POPULATION,
) -> pd.DataFrame:
    """
    Rollup département : 1 ligne par (source_file × campagne × code_departement).
    Conserve le calcul d'affinity au niveau IRIS (granularité fine) puis agrège
    par département pondéré par les impressions.
    """
    df_full = compute_affinity(df_full, baseline, min_population=min_population)
    df_full = df_full.copy()
    df_full["code_departement"] = df_full["code_commune"].apply(derive_code_departement)

    rows = []
    for (source_file, campaign_name, dept), gp in df_full[df_full["matched"]].groupby(
        ["source_file", "campaign_name", "code_departement"], dropna=False, sort=False,
    ):
        if dept is None or pd.isna(dept):
            continue
        total_imp = float(gp["imp"].sum())
        score, scorable_imp = _weighted_score(gp)

        per_iris = gp.groupby("code_iris", as_index=False).agg(
            imp=("imp", "sum"),
            affinity=("affinity", "first"),
        )
        on_target_imp, neutral_imp, off_target_imp = _band_imp(per_iris)
        pct = lambda v: v / scorable_imp * 100 if scorable_imp > 0 else 0.0

        rows.append({
            "source_file": source_file,
            "campaign_name": campaign_name,
            "code_departement": dept,
            "nom_departement": DEPT_NAMES.get(dept, ""),
            "nb_iris_touched": int(per_iris.shape[0]),
            "total_impressions": int(round(total_imp)),
            "score_alignment": round(score, 2) if not pd.isna(score) else None,
            "pct_imp_on_target": round(pct(on_target_imp), 2),
            "pct_imp_neutral": round(pct(neutral_imp), 2),
            "pct_imp_off_target": round(pct(off_target_imp), 2),
        })

    df_dept = pd.DataFrame(rows)
    if df_dept.empty:
        return df_dept

    # Part de la campagne livrée sur ce département
    df_dept["pct_total_imp"] = df_dept.groupby(
        ["source_file", "campaign_name"], sort=False
    )["total_impressions"].transform(lambda s: s / s.sum() * 100).round(2)

    return df_dept.sort_values(
        ["source_file", "campaign_name", "total_impressions"], ascending=[True, True, False],
    ).reset_index(drop=True)


# ─────────────────────────────────────────────────────────────────────────────
# Pipeline principal
# ─────────────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Score d'alignement géo socio-démo pour campagnes Adform.")
    p.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    p.add_argument("--output", type=Path, default=None)
    p.add_argument("--target-cols", type=str, default=None,
                   help="Colonnes cible séparées par virgule (bypass menu).")
    p.add_argument("--denominator-col", type=str, default=None,
                   help="Override de la détection auto du dénominateur.")
    p.add_argument("--target-label", type=str, default=None,
                   help="Label custom à utiliser dans l'output (par défaut : col1+col2).")
    p.add_argument("--min-population", type=int, default=DEFAULT_MIN_POPULATION,
                   help=f"Seuil min de pop IRIS pour le calcul d'affinity "
                        f"(défaut : {DEFAULT_MIN_POPULATION}, anti-outliers).")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    input_dir: Path = args.input
    output_dir: Path = args.output or (input_dir / "_output")
    output_dir.mkdir(parents=True, exist_ok=True)

    log.info("Input  : %s", input_dir)
    log.info("Output : %s", output_dir)

    # 1. Scan + load
    files = scan_files(input_dir)
    if not files:
        log.error("Aucun fichier .xlsx/.xls/.csv détecté dans %s", input_dir)
        return 1
    log.info("📂 %d fichier(s) détecté(s)", len(files))

    df_raw, load_stats = load_all_files(files)
    if df_raw.empty:
        log.error("Aucune ligne chargée — abort.")
        return 1

    # 2. Filtre France
    df = filter_france(df_raw)
    if df.empty:
        log.error("Aucune ligne France après filtrage — abort.")
        return 1

    # 3. Connexion Supabase HTTPS + découverte colonnes IRIS
    client = connect_db()
    iris_cols = discover_iris_columns(client)
    log.info("🧬 %d colonnes IRIS numériques détectées", len(iris_cols))

    # 4. Sélection cible
    if args.target_cols:
        target_cols, denominator, target_label = select_target_cli(
            args.target_cols, iris_cols, args.denominator_col)
        log.info("Bypass menu : target=%s denom=%s", target_cols, denominator)
    else:
        target_cols, denominator, target_label = select_target_interactive(
            iris_cols, args.denominator_col)

    if args.target_label:
        target_label = args.target_label

    # 5. Baseline national
    baseline_ratio, sum_target_fr, sum_denom_fr = fetch_baseline(
        client, target_cols, denominator, min_population=args.min_population)
    log.info("🇫🇷 Baseline national (is_true_iris=true, pop≥%d) : %.2f%% (%.0f / %.0f)",
             args.min_population, baseline_ratio * 100, sum_target_fr, sum_denom_fr)

    # 6. Matching postal_code → IRIS + explosion (1 ligne campaign×postal × N IRIS)
    distinct_postals = df["postal_code"].dropna().unique().tolist()
    log.info("🔗 Matching IRIS pour %d postal_codes distincts…", len(distinct_postals))
    df_full = match_iris(client, df, target_cols, denominator)
    matched_rows = df_full[df_full["matched"]]
    n_matched_postals = matched_rows["postal_code"].nunique()
    log.info("   %d postal_codes matchés (%.1f%%) → %d IRIS",
             n_matched_postals,
             100 * n_matched_postals / max(len(distinct_postals), 1),
             matched_rows["code_iris"].nunique())

    # 8. Calcul métriques par campagne
    out = compute_campaign_metrics(df_full, baseline_ratio,
                                   min_population=args.min_population)
    out_clean = out.drop(columns=["_per_iris_internal"]).copy()
    out_clean.insert(3, "target_label", target_label)

    # 9. Export CSV — par campagne + par département
    csv_path = output_dir / "score_campaigns.csv"
    out_clean.to_csv(csv_path, index=False, encoding="utf-8")
    log.info("💾 Campagnes : %s", csv_path)

    df_dept = compute_department_metrics(
        df_full, baseline_ratio, min_population=args.min_population)
    if not df_dept.empty:
        df_dept.insert(2, "target_label", target_label)
        dept_path = output_dir / f"score_departments_{target_label}.csv"
        df_dept.to_csv(dept_path, index=False, encoding="utf-8")
        log.info("💾 Départements : %s (%d lignes)", dept_path, len(df_dept))

    # 10. Persist last config
    last_conf = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "target_cols": target_cols,
        "target_label": target_label,
        "denominator": denominator,
        "min_population": int(args.min_population),
        "baseline_ratio": baseline_ratio,
        "baseline_pct": round(baseline_ratio * 100, 4),
        "sum_target_fr": sum_target_fr,
        "sum_denom_fr": sum_denom_fr,
        "input_dir": str(input_dir),
        "files": [p.name for p in files],
        "load_stats": load_stats,
    }
    (output_dir / "_last_target.json").write_text(
        json.dumps(last_conf, indent=2, ensure_ascii=False), encoding="utf-8")

    # 11. Résumé console
    print()
    print("───── Résumé du batch ─────")
    print(f"  Fichiers : détectés={load_stats['detected']} chargés={load_stats['loaded']} "
          f"erreurs={load_stats['errors']}")
    print(f"  Cible    : {target_label}  (denom: {denominator})")
    print(f"  Baseline : {baseline_ratio*100:.2f}%")
    if not out_clean.empty:
        avg_match = out_clean["iris_match_rate"].mean()
        avg_score = out_clean["score_alignment"].dropna().mean()
        print(f"  iris_match_rate moyen : {avg_match:.1f}%")
        print(f"  score_alignment moyen : {avg_score:.1f}")

        valid = out_clean.dropna(subset=["score_alignment"])
        if not valid.empty:
            best = valid.loc[valid["score_alignment"].idxmax()]
            worst = valid.loc[valid["score_alignment"].idxmin()]
            print(f"  🥇 Mieux alignée : {best['campaign_name']}  ({best['score_alignment']:.1f})")
            print(f"  🥉 Pire alignée  : {worst['campaign_name']}  ({worst['score_alignment']:.1f})")

        # Top 3 dérives globales (overdelivered tous fichiers)
        all_iris = []
        for _, r in out.iterrows():
            df_iris = r["_per_iris_internal"]
            if df_iris is None or df_iris.empty:
                continue
            df_iris = df_iris.copy()
            df_iris["campaign_name"] = r["campaign_name"]
            all_iris.append(df_iris)
        if all_iris:
            allcat = pd.concat(all_iris, ignore_index=True)
            drift = allcat[allcat["affinity"] < 80].sort_values("imp", ascending=False).head(3)
            if not drift.empty:
                print("  Top 3 dérives globales (low affinity × forte livraison) :")
                for _, r in drift.iterrows():
                    print(f"    {r['code_iris']:>10}  {(r['nom_commune'] or '')[:30]:<30}  "
                          f"aff={r['affinity']:>5.1f}  imp={int(r['imp']):>8}  "
                          f"({r['campaign_name']})")
    print()
    return 0


# ─────────────────────────────────────────────────────────────────────────────
# API publique pour réutilisation (notebook, scripts tiers)
# ─────────────────────────────────────────────────────────────────────────────

def load_campaigns(input_dir: Path | str) -> tuple[pd.DataFrame, dict]:
    """Scan + load + filtre France sur un dossier. Retourne (df, stats)."""
    input_dir = Path(input_dir)
    files = scan_files(input_dir)
    df_raw, stats = load_all_files(files)
    if df_raw.empty:
        return df_raw, stats
    df = filter_france(df_raw)
    stats["files"] = [p.name for p in files]
    stats["rows_france"] = len(df)
    return df, stats


def match_iris(
    client: Client,
    df_campaigns: pd.DataFrame,
    target_cols: list[str],
    denominator: str,
) -> pd.DataFrame:
    """
    Matching postal_code → IRIS via RPC + jointure / explosion sur df_campaigns.
    Retourne un DataFrame avec 1 ligne par (source_file × campaign × postal × IRIS),
    avec colonnes `imp` (tracked_ads × share), `target_value`, `denom_value`,
    `matched`, `unique_reach_row`.
    """
    distinct_postals = df_campaigns["postal_code"].dropna().unique().tolist()
    pmap = fetch_postal_to_iris(client, distinct_postals, target_cols, denominator)
    df_full = df_campaigns.merge(pmap, on="postal_code", how="left")
    df_full["matched"] = df_full["code_iris"].notna()
    df_full["share"] = df_full["share"].fillna(1.0)
    df_full["imp"] = df_full["tracked_ads"].astype(float) * df_full["share"]
    df_full["unique_reach_row"] = 0
    first_idx = df_full.groupby(
        ["source_file", "campaign_name", "postal_code"], dropna=False, sort=False,
    ).head(1).index
    df_full.loc[first_idx, "unique_reach_row"] = df_full.loc[first_idx, "unique_reach"]
    return df_full


def score_campaign(
    df_full: pd.DataFrame,
    baseline: float,
    min_population: int = DEFAULT_MIN_POPULATION,
) -> pd.DataFrame:
    """Alias high-level : DataFrame matché → métriques par campagne."""
    return compute_campaign_metrics(df_full, baseline, min_population=min_population)


def score_department(
    df_full: pd.DataFrame,
    baseline: float,
    min_population: int = DEFAULT_MIN_POPULATION,
) -> pd.DataFrame:
    """Alias high-level : DataFrame matché → rollup par département."""
    return compute_department_metrics(df_full, baseline, min_population=min_population)


if __name__ == "__main__":
    sys.exit(main())
