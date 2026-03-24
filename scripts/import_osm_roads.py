# -*- coding: utf-8 -*-
"""
Import routes OSM → comptages_routiers (source='osm_highway_proxy')
Proxy de trafic basé sur la classification highway OSM.

Usage :
    python -X utf8 scripts/import_osm_roads.py --all
    python -X utf8 scripts/import_osm_roads.py --ville "BREST"
    python -X utf8 scripts/import_osm_roads.py --all --dry-run

Les données CEREMA existantes (source='tmja_rrn_national') ne sont PAS modifiées.
ON CONFLICT DO NOTHING sur osm_id (déduplication si plusieurs villes bbox se chevauchent).
"""

import argparse
import json
import sys
import time

import requests
from supabase import create_client

SUPABASE_URL = "https://vkkdbygwbrxyogqosten.supabase.co"
SUPABASE_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZra2RieWd3YnJ4eW9ncW9zdGVuIiwicm9sZSI"
    "6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTE4OTk2MCwiZXhwIjoyMDg2NzY1OTYwfQ"
    ".hZQcgjx8AbkDF6o1oETQYURnQB9hHi7p0nuXKFjyFrU"
)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
BATCH = 300
SLEEP_BETWEEN_CITIES = 5   # secondes entre requêtes Overpass
RETRY_WAIT = 30            # secondes avant retry après erreur

# Proxy TMJA basé sur la classification OSM highway
HIGHWAY_TMJA_PROXY = {
    "motorway":       30000,
    "motorway_link":  20000,
    "trunk":          20000,
    "trunk_link":     15000,
    "primary":        12000,
    "primary_link":   10000,
    "secondary":       7000,
    "secondary_link":  5000,
    "tertiary":        4000,
    "tertiary_link":   3000,
    "residential":     1500,
    "unclassified":     800,
}

HIGHWAY_CLASSES = list(HIGHWAY_TMJA_PROXY.keys())
HIGHWAY_FILTER = "|".join(HIGHWAY_CLASSES)


def fetch_roads(south: float, west: float, north: float, east: float, retries: int = 3) -> dict:
    """Requête Overpass API pour récupérer les routes dans le bbox."""
    query = f"""
[out:json][timeout:120];
(
  way["highway"~"^({HIGHWAY_FILTER})$"]({south:.6f},{west:.6f},{north:.6f},{east:.6f});
);
out geom;
"""
    for attempt in range(retries):
        try:
            resp = requests.get(OVERPASS_URL, params={"data": query}, timeout=130)
            if resp.status_code == 429:
                print(f"  [429] Rate limit. Attente {RETRY_WAIT}s…")
                time.sleep(RETRY_WAIT)
                continue
            resp.raise_for_status()
            return resp.json()
        except requests.exceptions.Timeout:
            print(f"  [Timeout] Tentative {attempt+1}/{retries}. Attente {RETRY_WAIT}s…")
            time.sleep(RETRY_WAIT)
        except requests.exceptions.RequestException as e:
            print(f"  [Erreur] {e}. Tentative {attempt+1}/{retries}.")
            time.sleep(RETRY_WAIT)
    return {"elements": []}


def parse_ways(elements: list, ville: str) -> list[dict]:
    """Parse les ways OSM en lignes pour comptages_routiers."""
    rows = []
    for el in elements:
        if el.get("type") != "way":
            continue
        osm_id = el.get("id")
        tags = el.get("tags", {})
        highway = tags.get("highway", "")
        if highway not in HIGHWAY_TMJA_PROXY:
            continue

        geometry = el.get("geometry", [])
        if len(geometry) < 2:
            continue

        # Construire WKT LineString (coordonnées déjà WGS84)
        coords_str = ",".join(
            f"{pt['lon']:.7f} {pt['lat']:.7f}" for pt in geometry
        )
        geom_wkt = f"SRID=4326;LINESTRING({coords_str})"

        # Midpoint = milieu géographique du way
        mid_idx = len(geometry) // 2
        mid_lon = geometry[mid_idx]["lon"]
        mid_lat = geometry[mid_idx]["lat"]
        midpoint_wkt = f"SRID=4326;POINT({mid_lon:.7f} {mid_lat:.7f})"

        name = tags.get("name") or tags.get("ref") or highway
        tmja = HIGHWAY_TMJA_PROXY[highway]

        rows.append({
            "osm_id": osm_id,
            "route": name,
            "tmja": tmja,
            "ratio_pl": None,
            "annee_mesure": None,
            "type_comptage": None,
            "longueur_m": None,
            "departement": None,
            "source": "osm_highway_proxy",
            "geom": geom_wkt,
            "geom_midpoint": midpoint_wkt,
            "metadata": json.dumps({
                "osm_id": osm_id,
                "highway_class": highway,
                "ville": ville,
            }),
        })
    return rows


def insert_rows(supabase, rows: list[dict]) -> int:
    """Insère en batch avec ON CONFLICT DO NOTHING sur osm_id."""
    inserted = 0
    for i in range(0, len(rows), BATCH):
        batch = rows[i: i + BATCH]
        # upsert avec ignoreDuplicates pour ON CONFLICT DO NOTHING
        supabase.table("comptages_routiers").upsert(
            batch,
            ignore_duplicates=True,
            on_conflict="osm_id"
        ).execute()
        inserted += len(batch)
    return inserted


def load_villes(bbox_file: str) -> list[dict]:
    with open(bbox_file, encoding="utf-8") as f:
        return json.load(f)


def compute_bbox(v: dict, padding: float = 0.02) -> tuple[float, float, float, float]:
    """
    Calcule le bbox avec padding.
    - padding en degrés (~2km pour 0.02°)
    - Minimum 0.03° de côté (villes avec 1 seul panneau)
    """
    south = v["min_lat"] - padding
    north = v["max_lat"] + padding
    west  = v["min_lng"] - padding
    east  = v["max_lng"] + padding

    # Bbox minimum de 0.03° × 0.03°
    lat_center = (south + north) / 2
    lng_center = (west + east) / 2
    if (north - south) < 0.03:
        south = lat_center - 0.015
        north = lat_center + 0.015
    if (east - west) < 0.03:
        west  = lng_center - 0.015
        east  = lng_center + 0.015

    return south, west, north, east


def process_ville(supabase, v: dict, dry_run: bool = False) -> int:
    south, west, north, east = compute_bbox(v)
    data = fetch_roads(south, west, north, east)
    elements = data.get("elements", [])
    rows = parse_ways(elements, v["ville"])

    if dry_run:
        print(f"  [DRY RUN] {len(elements)} éléments → {len(rows)} routes parsées")
        return len(rows)

    if not rows:
        return 0

    return insert_rows(supabase, rows)


def main():
    parser = argparse.ArgumentParser(description="Import routes OSM → comptages_routiers")
    parser.add_argument("--all", action="store_true", help="Toutes les villes depuis villes_bbox.json")
    parser.add_argument("--ville", help="Une seule ville (ex: BREST)")
    parser.add_argument("--bbox-file", default="data/raw/villes_bbox.json", help="Fichier JSON des villes")
    parser.add_argument("--dry-run", action="store_true", help="Parse sans insérer")
    args = parser.parse_args()

    if not args.all and not args.ville:
        parser.error("Fournir --all ou --ville NOM")

    villes = load_villes(args.bbox_file)

    if args.ville:
        villes = [v for v in villes if v["ville"].upper() == args.ville.upper()]
        if not villes:
            print(f"Ville '{args.ville}' non trouvée dans {args.bbox_file}")
            sys.exit(1)

    print(f"\n=== Import OSM roads : {len(villes)} ville(s) ===\n")

    supabase = None if args.dry_run else create_client(SUPABASE_URL, SUPABASE_KEY)

    total_routes = 0
    errors = []

    for i, v in enumerate(villes):
        ville = v["ville"]
        nb_panneaux = v.get("nb", "?")
        south, west, north, east = compute_bbox(v)
        print(f"[{i+1:3d}/{len(villes)}] {ville:35s} ({nb_panneaux} panneaux) bbox=({south:.3f},{west:.3f},{north:.3f},{east:.3f})")

        try:
            nb = process_ville(supabase, v, dry_run=args.dry_run)
            total_routes += nb
            print(f"         → {nb} routes {'parsées' if args.dry_run else 'insérées'}")
        except Exception as e:
            print(f"         [ERREUR] {e}")
            errors.append((ville, str(e)))

        if i < len(villes) - 1:
            time.sleep(SLEEP_BETWEEN_CITIES)

    print(f"\n{'='*60}")
    print(f"Terminé : {total_routes} routes {'parsées' if args.dry_run else 'insérées'} sur {len(villes)} villes")
    if errors:
        print(f"Erreurs ({len(errors)}) :")
        for ville, err in errors:
            print(f"  {ville}: {err}")


if __name__ == "__main__":
    main()
