# -*- coding: utf-8 -*-
"""
Import arrêts de transport consolidés France → poi_france (categorie='arret_transport')
Source : transport.data.gouv.fr — fichier consolidé tous réseaux GTFS

Usage :
    python -X utf8 scripts/import_arrets_france.py --file data/raw/arrets_transport_france.csv
    python -X utf8 scripts/import_arrets_france.py --file data/raw/arrets_transport_france.csv --dry-run

Déduplication : nom + ROUND(lat, 4) + ROUND(lng, 4)
ON CONFLICT DO NOTHING sur idx_poi_france_transport_dedup
"""

import argparse
import json
import sys
import time

import pandas as pd
from supabase import create_client

SUPABASE_URL = "https://vkkdbygwbrxyogqosten.supabase.co"
SUPABASE_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZra2RieWd3YnJ4eW9ncW9zdGVuIiwicm9sZSI"
    "6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTE4OTk2MCwiZXhwIjoyMDg2NzY1OTYwfQ"
    ".hZQcgjx8AbkDF6o1oETQYURnQB9hHi7p0nuXKFjyFrU"
)

CHUNK_SIZE  = 50_000
BATCH_SIZE  = 5_000
SOURCE      = "gtfs_consolidated_france"

# route_type GTFS → sous_categorie
ROUTE_TYPE_MAP = {
    0: "tram",
    1: "metro",
    2: "train",
    3: "bus",
    4: "ferry",
    5: "cable",
    7: "funicular",
    11: "trolleybus",
    12: "monorail",
}


def sous_type_from_name(name: str) -> str:
    """Heuristique sur le nom si route_type absent."""
    n = str(name).lower()
    if "tram" in n:           return "tram"
    if "tramway" in n:        return "tram"
    if "metro" in n:          return "metro"
    if "métro" in n:          return "metro"
    if "rer" in n:            return "train"
    if "train" in n:          return "train"
    if "gare" in n:           return "train"
    return "bus"


def build_row(r: pd.Series) -> dict:
    lat = float(r["stop_lat"])
    lng = float(r["stop_lon"])
    nom = str(r["stop_name"]).strip()

    # Sous-catégorie
    sous_cat = sous_type_from_name(nom)

    meta: dict = {}
    if pd.notna(r.get("stop_id")):
        meta["stop_id"] = str(r["stop_id"])
    if pd.notna(r.get("dataset_id")):
        meta["dataset_id"] = str(r["dataset_id"])
    if pd.notna(r.get("agency_name")):
        meta["agency"] = str(r["agency_name"])

    return {
        "categorie":      "arret_transport",
        "sous_categorie": sous_cat,
        "nom":            nom,
        "lat":            round(lat, 7),
        "lng":            round(lng, 7),
        "ville":          None,
        "source":         SOURCE,
        "metadata":       meta,
    }


def insert_batch(supabase, rows: list[dict]) -> tuple[int, int]:
    """Insère un batch, retourne (insérés, ignorés)."""
    try:
        resp = (
            supabase.table("poi_france")
            .upsert(rows, ignore_duplicates=True, on_conflict="nom,ROUND(lat::numeric,4),ROUND(lng::numeric,4)")
            .execute()
        )
        inserted = len(resp.data) if resp.data else 0
        ignored  = len(rows) - inserted
    except Exception as e:
        # Fallback: insert sans upsert pour éviter l'erreur de conflit partiel
        try:
            resp = supabase.table("poi_france").insert(rows, count="exact").execute()
            inserted = resp.count or len(rows)
            ignored  = 0
        except Exception as e2:
            print(f"    [ERREUR batch] {e2}")
            return 0, len(rows)
    return inserted, ignored


def main():
    parser = argparse.ArgumentParser(description="Import arrêts transport France → poi_france")
    parser.add_argument("--file", required=True, help="Fichier CSV consolidé")
    parser.add_argument("--dry-run", action="store_true", help="Parse sans insérer")
    args = parser.parse_args()

    print(f"\n=== Import arrêts transport France : {args.file} ===\n")

    supabase = None if args.dry_run else create_client(SUPABASE_URL, SUPABASE_KEY)

    total_rows      = 0
    total_inserted  = 0
    total_skipped   = 0   # hors-France ou sans coords
    total_ignored   = 0   # doublons ON CONFLICT
    seen_keys:      set  = set()
    chunk_num       = 0

    for chunk in pd.read_csv(
        args.file,
        sep=",",
        encoding="utf-8",
        chunksize=CHUNK_SIZE,
        low_memory=False,
    ):
        chunk_num += 1
        total_rows += len(chunk)

        # Filtre location_type = 0 (arrêts physiques)
        chunk = chunk[chunk["location_type"].isin([0, "0"]) | chunk["location_type"].isna()]

        # Filtre coordonnées valides + France métro
        chunk = chunk.dropna(subset=["stop_lat", "stop_lon"])
        chunk["stop_lat"] = pd.to_numeric(chunk["stop_lat"], errors="coerce")
        chunk["stop_lon"] = pd.to_numeric(chunk["stop_lon"], errors="coerce")
        chunk = chunk.dropna(subset=["stop_lat", "stop_lon"])
        chunk = chunk[
            chunk["stop_lat"].between(41.0, 51.5) &
            chunk["stop_lon"].between(-5.5, 10.0)
        ]
        total_skipped += CHUNK_SIZE - len(chunk)  # approx

        # Déduplication en mémoire (nom + coords arrondis)
        chunk["_key"] = (
            chunk["stop_name"].astype(str).str.strip() + "_" +
            chunk["stop_lat"].round(4).astype(str) + "_" +
            chunk["stop_lon"].round(4).astype(str)
        )
        before_dedup = len(chunk)
        chunk = chunk[~chunk["_key"].isin(seen_keys)]
        chunk = chunk.drop_duplicates(subset=["_key"])
        seen_keys.update(chunk["_key"].tolist())
        deduped = before_dedup - len(chunk)

        rows = [build_row(r) for _, r in chunk.iterrows()]

        if args.dry_run:
            print(f"  Chunk {chunk_num}: {len(rows)} arrêts uniques ({deduped} doublons filtrés)")
            if chunk_num == 1 and rows:
                print(f"  Exemple : {rows[0]['nom']} lat={rows[0]['lat']} lng={rows[0]['lng']}")
            continue

        # Insert par batch
        chunk_inserted = 0
        chunk_ignored  = 0
        for i in range(0, len(rows), BATCH_SIZE):
            batch = rows[i: i + BATCH_SIZE]
            ins, ign = insert_batch(supabase, batch)
            chunk_inserted += ins
            chunk_ignored  += ign
            time.sleep(0.05)

        total_inserted += chunk_inserted
        total_ignored  += chunk_ignored

        print(
            f"  Chunk {chunk_num} ({total_rows:,} lus) — "
            f"{len(rows)} candidats, {chunk_inserted} insérés, "
            f"{chunk_ignored} ignorés (doublons BDD)"
        )

    print(f"\n{'='*60}")
    if args.dry_run:
        print(f"[DRY RUN] {len(seen_keys):,} arrêts uniques identifiés sur {total_rows:,} lignes brutes")
    else:
        print(f"Terminé : {total_inserted:,} arrêts insérés, {total_ignored:,} ignorés")
        print(f"Total lignes traitées : {total_rows:,}")


if __name__ == "__main__":
    main()
