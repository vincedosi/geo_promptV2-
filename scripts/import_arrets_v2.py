#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Import arrêts transport France via supabase-py — INSERT simple (table vide).

Table est vide → pas de ON CONFLICT nécessaire.
Dédup en mémoire (seen set) → zéro doublon dans les batches.

Usage:
    python -X utf8 scripts/import_arrets_v2.py data/raw/arrets_transport_france.csv
"""

import os
import sys
import time

import pandas as pd
from supabase import create_client

SUPABASE_URL = "https://vkkdbygwbrxyogqosten.supabase.co"
# La cle `service_role` contourne toute RLS : elle ne doit JAMAIS figurer dans
# le depot. Elle etait ecrite en clair ici, et dans six autres scripts, jusqu'au
# 2026-09-11. Elle se lit desormais dans l'environnement.
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
if not SUPABASE_KEY:
    raise SystemExit(
        """SUPABASE_SERVICE_ROLE_KEY absente de l'environnement.
Ce script ecrit en base avec la cle service_role. La definir avant de lancer :
  PowerShell : $env:SUPABASE_SERVICE_ROLE_KEY = '...'
  bash       : export SUPABASE_SERVICE_ROLE_KEY='...'"""
    )

CSV_PATH   = sys.argv[1] if len(sys.argv) > 1 else "data/raw/arrets_transport_france.csv"
CHUNK_SIZE = 50_000
BATCH_SIZE = 3_000    # plus petit = moins de risque de timeout
SOURCE     = "gtfs_consolidated_france"


def sous_type(nom: str) -> str:
    n = str(nom).lower()
    if "tram" in n:
        return "tram"
    if any(k in n for k in ("métro", "metro")):
        return "metro"
    if any(k in n for k in ("gare", "sncf", "train", "rer ")):
        return "train"
    return "bus"


def main():
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Vérifier que la table est bien vide
    check = supabase.table("poi_france").select("id", count="exact").eq("categorie", "arret_transport").execute()
    nb_existant = check.count or 0
    if nb_existant > 0:
        print(f"ATTENTION: {nb_existant} arrêts déjà présents. Supprimer avant de relancer.")
        print("SQL: DELETE FROM poi_france WHERE categorie = 'arret_transport' AND source = 'gtfs_consolidated_france';")
        if input("Continuer quand même ? (o/N) ").strip().lower() != "o":
            sys.exit(0)

    seen:          set   = set()
    total_lines         = 0
    total_inserted      = 0
    total_ignored_dedup = 0
    total_errors        = 0
    chunk_num           = 0
    start               = time.time()

    print(f"\nImport depuis: {CSV_PATH}")
    print(f"Batch size: {BATCH_SIZE} | Chunk size: {CHUNK_SIZE}\n")

    for chunk in pd.read_csv(
        CSV_PATH,
        sep=",",
        encoding="utf-8",
        chunksize=CHUNK_SIZE,
        low_memory=False,
    ):
        chunk_num  += 1
        total_lines += len(chunk)

        # Filtre location_type=0 (arrêts physiques seulement)
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

        # Dédup en mémoire
        chunk["_key"] = (
            chunk["stop_name"].astype(str).str.strip() + "_" +
            chunk["stop_lat"].round(4).astype(str) + "_" +
            chunk["stop_lon"].round(4).astype(str)
        )
        chunk = chunk[~chunk["_key"].isin(seen)]
        chunk = chunk.drop_duplicates(subset=["_key"])
        seen.update(chunk["_key"].tolist())

        # Construire les rows
        rows = []
        for _, r in chunk.iterrows():
            nom = str(r["stop_name"]).strip()
            lat = round(float(r["stop_lat"]), 7)
            lng = round(float(r["stop_lon"]), 7)
            meta: dict = {}
            if pd.notna(r.get("stop_id")):
                meta["stop_id"]    = str(r["stop_id"])
            if pd.notna(r.get("dataset_id")):
                meta["dataset_id"] = str(r["dataset_id"])
            if pd.notna(r.get("agency_name")):
                meta["agency"]     = str(r["agency_name"])
            rows.append({
                "categorie":      "arret_transport",
                "sous_categorie": sous_type(nom),
                "nom":            nom,
                "lat":            lat,
                "lng":            lng,
                "ville":          None,
                "source":         SOURCE,
                "metadata":       meta,
            })

        # Insert par batch
        chunk_inserted = 0
        for i in range(0, len(rows), BATCH_SIZE):
            batch = rows[i: i + BATCH_SIZE]
            try:
                resp = supabase.table("poi_france").insert(batch).execute()
                inserted = len(resp.data) if resp.data else len(batch)
                chunk_inserted += inserted
            except Exception as e:
                err_str = str(e)[:120]
                print(f"    [ERREUR batch {i//BATCH_SIZE + 1}] {err_str}")
                total_errors += len(batch)
                # Retry row-by-row pour récupérer les valides
                for row in batch:
                    try:
                        supabase.table("poi_france").insert(row).execute()
                        chunk_inserted += 1
                    except Exception:
                        pass
            time.sleep(0.03)

        total_inserted += chunk_inserted
        total_ignored_dedup = len(seen) - total_inserted  # approx

        elapsed = time.time() - start
        rate = total_inserted / elapsed if elapsed > 0 else 0
        print(
            f"  Chunk {chunk_num:2d} ({total_lines:>7,} lus) — "
            f"{len(rows):>6,} candidats, {chunk_inserted:>6,} insérés "
            f"| total: {total_inserted:>7,} | {rate:.0f} r/s | {elapsed:.0f}s"
        )

    elapsed = time.time() - start
    print(f"\n{'='*60}")
    print(f"TERMINÉ en {elapsed:.0f}s ({elapsed/60:.1f} min)")
    print(f"  Lignes CSV       : {total_lines:,}")
    print(f"  Uniques (mémoire): {len(seen):,}")
    print(f"  Insérés          : {total_inserted:,}")
    print(f"  Erreurs batch    : {total_errors:,}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
