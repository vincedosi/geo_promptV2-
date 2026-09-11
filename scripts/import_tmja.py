# -*- coding: utf-8 -*-
"""
Import TMJA (Trafic Moyen Journalier Annuel) → comptages_routiers
Source : data.gouv.fr — réseau routier national français

Usage :
    python -X utf8 scripts/import_tmja.py --file data/raw/tmja_national.csv
    python -X utf8 scripts/import_tmja.py --file data/raw/tmja_national.csv --dry-run

Notes :
    - Coordonnées source en Lambert93 (EPSG:2154) → conversion WGS84 (EPSG:4326)
    - Virgule décimale française → point float
    - ON CONFLICT : suppression totale + réinsertion propre par source
"""

import os
import argparse
import csv
import io
import json
import sys
import time

import pyproj
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
BATCH = 200

# Transformateur Lambert93 (EPSG:2154) → WGS84 (EPSG:4326)
_transformer = pyproj.Transformer.from_crs("EPSG:2154", "EPSG:4326", always_xy=True)


def fr_float(val: str) -> float | None:
    """Convertit un float français (virgule décimale) en float Python."""
    if val is None:
        return None
    s = str(val).strip().replace(",", ".")
    if not s or s in ("-", ""):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def lambert_to_wgs84(x: float, y: float) -> tuple[float, float]:
    """Retourne (lon, lat) en WGS84 depuis (x, y) Lambert93."""
    lon, lat = _transformer.transform(x, y)
    return lon, lat


def make_linestring(lon1, lat1, lon2, lat2) -> str:
    """WKT LineString en WGS84."""
    return f"SRID=4326;LINESTRING({lon1:.7f} {lat1:.7f},{lon2:.7f} {lat2:.7f})"


def make_point(lon1, lat1, lon2, lat2) -> str:
    """WKT Point milieu du segment."""
    mid_lon = (lon1 + lon2) / 2
    mid_lat = (lat1 + lat2) / 2
    return f"SRID=4326;POINT({mid_lon:.7f} {mid_lat:.7f})"


def parse_csv(filepath: str, source: str) -> list[dict]:
    rows = []
    skipped = 0

    with open(filepath, encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter=";")
        for i, row in enumerate(reader):
            xd = fr_float(row.get("xD"))
            yd = fr_float(row.get("yD"))
            xf = fr_float(row.get("xF"))
            yf = fr_float(row.get("yF"))

            if None in (xd, yd, xf, yf):
                skipped += 1
                continue

            tmja = fr_float(row.get("TMJA"))
            if tmja is None:
                skipped += 1
                continue

            try:
                lon_d, lat_d = lambert_to_wgs84(xd, yd)
                lon_f, lat_f = lambert_to_wgs84(xf, yf)
            except Exception:
                skipped += 1
                continue

            # Sanity check WGS84 France métropolitaine
            if not (-5.5 <= lon_d <= 10.0 and 41.0 <= lat_d <= 51.5):
                skipped += 1
                continue

            ratio_pl = fr_float(row.get("ratio_PL"))
            annee = row.get("anneeMesureTrafic", "").strip()
            type_c = row.get("typeComptageTrafic", "").strip()
            type_c_lib = row.get("typeComptageTrafic_lib", "").strip()
            longueur = fr_float(row.get("longueur"))
            dept = str(row.get("depPrD", "")).strip()
            route = str(row.get("route", "")).strip()

            rows.append({
                "route": route,
                "tmja": int(tmja),
                "ratio_pl": ratio_pl,
                "annee_mesure": int(annee) if annee.isdigit() else None,
                "type_comptage": type_c_lib or type_c or None,
                "longueur_m": longueur,
                "departement": dept or None,
                "source": source,
                "geom": make_linestring(lon_d, lat_d, lon_f, lat_f),
                "geom_midpoint": make_point(lon_d, lat_d, lon_f, lat_f),
                "metadata": json.dumps({
                    "date_referentiel": row.get("dateReferentiel", ""),
                    "pr_debut": row.get("prD", ""),
                    "pr_fin": row.get("prF", ""),
                }),
            })

    print(f"  Sections parsées : {len(rows)} | ignorées : {skipped}")
    return rows


def insert_rows(supabase, rows: list[dict], source: str) -> int:
    # Purge de l'ancienne source avant réinsertion
    print(f"  Suppression des sections existantes (source={source})…")
    supabase.table("comptages_routiers").delete().eq("source", source).execute()

    inserted = 0
    for i in range(0, len(rows), BATCH):
        batch = rows[i: i + BATCH]
        supabase.table("comptages_routiers").insert(batch).execute()
        inserted += len(batch)
        print(f"  Batch {i // BATCH + 1}: {len(batch)} sections insérées ({inserted}/{len(rows)})")
        time.sleep(0.05)

    return inserted


def main():
    parser = argparse.ArgumentParser(description="Import TMJA → comptages_routiers")
    parser.add_argument("--file", required=True, help="Chemin CSV local")
    parser.add_argument("--source", default="tmja_rrn_national", help="Valeur colonne source")
    parser.add_argument("--dry-run", action="store_true", help="Parse sans insérer")
    args = parser.parse_args()

    print(f"\n=== Import TMJA : {args.file} (source={args.source}) ===\n")

    rows = parse_csv(args.file, args.source)
    if not rows:
        print("Aucune section valide, arrêt.")
        sys.exit(1)

    print(f"\n{len(rows)} sections prêtes à l'insertion")
    print(f"  Exemple : {rows[0]['route']} TMJA={rows[0]['tmja']} dept={rows[0]['departement']}")
    print(f"  geom    : {rows[0]['geom'][:60]}…")

    if args.dry_run:
        print("\n[DRY RUN] Aperçu des 5 premières sections :")
        for r in rows[:5]:
            print(f"  {r['route']:10s} TMJA={r['tmja']:6d} dept={r['departement']}  midpoint={r['geom_midpoint']}")
        return

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    t0 = time.time()
    inserted = insert_rows(supabase, rows, args.source)
    elapsed = time.time() - t0
    print(f"\nTerminé : {inserted} sections insérées en {elapsed:.1f}s")


if __name__ == "__main__":
    main()
