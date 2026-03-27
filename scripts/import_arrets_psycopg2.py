#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Import arrêts transport France entière via psycopg2 (connexion directe PostgreSQL).

Usage:
    python -X utf8 scripts/import_arrets_psycopg2.py [chemin_csv]

Déduplique en mémoire sur (nom + ROUND(lat,4) + ROUND(lng,4)).
Insère directement via execute_values, commit toutes les BATCH_SIZE lignes.
"""

import csv
import os
import sys
import time

import psycopg2
from psycopg2.extras import execute_values

# ── Config ────────────────────────────────────────────────────────────────────
CSV_PATH   = sys.argv[1] if len(sys.argv) > 1 else "data/raw/arrets_transport_france.csv"
BATCH_SIZE = 5000
SOURCE     = "gtfs_consolidated_france"
ENCODING   = "utf-8"

# ── Connexion DB ──────────────────────────────────────────────────────────────
def _find_db_url() -> str:
    # 1. Variable d'environnement
    for key in ("DATABASE_URL", "DIRECT_URL", "SUPABASE_DB_URL"):
        if os.environ.get(key):
            return os.environ[key]
    # 2. Fichiers .env
    for env_file in (".env.local", ".env"):
        if not os.path.exists(env_file):
            continue
        with open(env_file, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("#") or "=" not in line:
                    continue
                key, val = line.split("=", 1)
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                if key in ("DATABASE_URL", "DIRECT_URL", "SUPABASE_DB_URL"):
                    return val
    return ""


# ── Utilitaires ───────────────────────────────────────────────────────────────
def sous_type_from_name(nom: str) -> str:
    n = nom.lower()
    if any(k in n for k in ("tram", "tramway", "T1", "T2", "T3")):
        return "arret_tram"
    if any(k in n for k in ("métro", "metro", "rer ", "m°")):
        return "arret_metro"
    if any(k in n for k in ("gare", "sncf", "ter ", "intercité", "train")):
        return "arret_train"
    return "arret_bus"


def insert_batch(cur, batch: list[tuple]) -> None:
    """Insère un batch via execute_values avec geom calculé côté SQL."""
    sql = """
        INSERT INTO poi_france
            (categorie, sous_categorie, nom, lat, lng, geom, source, metadata)
        VALUES %s
    """
    template = """(
        %s, %s, %s, %s, %s,
        ST_SetSRID(ST_MakePoint(%s, %s), 4326),
        %s, %s::jsonb
    )"""
    # Ordre : categorie, sous_cat, nom, lat, lng, lng(geom), lat(geom), source, meta
    rows = [
        (cat, sub, nom, lat, lng, lng, lat, src, meta)
        for cat, sub, nom, lat, lng, src, meta in batch
    ]
    execute_values(cur, sql, rows, template=template, page_size=BATCH_SIZE)
    cur.connection.commit()


# ── Main ──────────────────────────────────────────────────────────────────────
def main() -> None:
    db_url = _find_db_url()
    if not db_url:
        print("ERREUR: Pas de DATABASE_URL. Définis-la dans .env.local ou en variable d'env.")
        sys.exit(1)

    # Masquer le mot de passe dans l'affichage
    masked = db_url[:40] + "..." if len(db_url) > 40 else db_url
    print(f"Connexion: {masked}")

    conn = psycopg2.connect(db_url)
    cur  = conn.cursor()
    print("Connexion PostgreSQL OK\n")

    seen:    set[str] = set()
    batch:   list[tuple] = []
    total_inserted         = 0
    total_skipped_dedup    = 0
    total_skipped_invalid  = 0
    total_lines            = 0
    start = time.time()

    with open(CSV_PATH, encoding=ENCODING, newline="") as f:
        reader = csv.reader(f)
        header = next(reader)
        header_lc = [h.lower().strip() for h in header]

        # Mapping colonnes
        def col(candidates):
            for c in candidates:
                if c in header_lc:
                    return header_lc.index(c)
            return None

        c_name = col(["stop_name", "nom", "name"])
        c_lat  = col(["stop_lat",  "lat", "latitude"])
        c_lon  = col(["stop_lon",  "lon", "lng", "longitude"])
        c_type = col(["location_type"])
        c_id   = col(["stop_id",   "id"])
        c_ag   = col(["agency_name"])
        c_did  = col(["dataset_id"])

        if c_name is None or c_lat is None or c_lon is None:
            print(f"ERREUR: colonnes manquantes — name={c_name}, lat={c_lat}, lon={c_lon}")
            print(f"Header: {header}")
            sys.exit(1)

        print(f"Colonnes: name[{c_name}]={header[c_name]}, lat[{c_lat}]={header[c_lat]}, lon[{c_lon}]={header[c_lon]}")
        if c_type is not None:
            print(f"  location_type[{c_type}]={header[c_type]} (filtre sur =0 actif)")
        print()

        for row in reader:
            total_lines += 1

            try:
                # Filtre location_type = 0 (arrêts physiques seulement)
                if c_type is not None:
                    lt = row[c_type].strip() if c_type < len(row) else ""
                    if lt and lt != "0":
                        total_skipped_invalid += 1
                        continue

                name    = row[c_name].strip() if c_name < len(row) else ""
                lat_str = row[c_lat].strip()  if c_lat  < len(row) else ""
                lon_str = row[c_lon].strip()  if c_lon  < len(row) else ""

                if not name or not lat_str or not lon_str:
                    total_skipped_invalid += 1
                    continue

                lat = float(lat_str)
                lon = float(lon_str)

                # Filtre France métropolitaine
                if not (41.0 <= lat <= 51.5 and -5.5 <= lon <= 10.0):
                    total_skipped_invalid += 1
                    continue

                # Dédup en mémoire
                dedup_key = f"{name}_{round(lat, 4)}_{round(lon, 4)}"
                if dedup_key in seen:
                    total_skipped_dedup += 1
                    continue
                seen.add(dedup_key)

                # Métadonnées
                meta_parts = []
                if c_id  is not None and c_id  < len(row) and row[c_id].strip():
                    meta_parts.append(f'"stop_id":"{row[c_id].strip()}"')
                if c_ag  is not None and c_ag  < len(row) and row[c_ag].strip():
                    ag = row[c_ag].strip().replace('"', '\\"')
                    meta_parts.append(f'"agency":"{ag}"')
                if c_did is not None and c_did < len(row) and row[c_did].strip():
                    meta_parts.append(f'"dataset_id":"{row[c_did].strip()}"')
                meta = "{" + ",".join(meta_parts) + "}" if meta_parts else "{}"

                batch.append((
                    "arret_transport",
                    sous_type_from_name(name),
                    name,
                    lat,
                    lon,
                    SOURCE,
                    meta,
                ))

                if len(batch) >= BATCH_SIZE:
                    insert_batch(cur, batch)
                    total_inserted += len(batch)
                    batch = []
                    elapsed = time.time() - start
                    rate = total_inserted / elapsed if elapsed > 0 else 0
                    print(
                        f"  {total_lines:>7,} lus | {total_inserted:>7,} insérés "
                        f"| {total_skipped_dedup:>7,} doublons "
                        f"| {total_skipped_invalid:>6,} ignorés "
                        f"| {rate:.0f} r/s"
                    )

            except (ValueError, IndexError):
                total_skipped_invalid += 1
                continue

    # Dernier batch
    if batch:
        insert_batch(cur, batch)
        total_inserted += len(batch)

    cur.close()
    conn.close()

    elapsed = time.time() - start
    print(f"\n{'='*60}")
    print(f"TERMINÉ en {elapsed:.0f}s ({elapsed/60:.1f} min)")
    print(f"  Lignes CSV lues   : {total_lines:,}")
    print(f"  Arrêts insérés    : {total_inserted:,}")
    print(f"  Doublons ignorés  : {total_skipped_dedup:,}")
    print(f"  Hors zone / vides : {total_skipped_invalid:,}")
    print(f"  Clés dédup (set)  : {len(seen):,}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
