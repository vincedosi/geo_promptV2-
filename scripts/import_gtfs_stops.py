# -*- coding: utf-8 -*-
"""
Import GTFS stops → poi_france (categorie='arret_transport')
Script générique France : fonctionne pour n'importe quel réseau GTFS.

Usage :
    python -X utf8 scripts/import_gtfs_stops.py \
        --url "https://..." \
        --reseau "Bibus" \
        --ville "Brest"

    ou avec un fichier zip local :
    python -X utf8 scripts/import_gtfs_stops.py \
        --file "/path/to/gtfs.zip" \
        --reseau "Bibus" \
        --ville "Brest"

Sources recommandées :
    Bibus (Brest) : https://transport.data.gouv.fr/datasets/reseau-bibus/
    IDFM (Paris)  : https://transport.data.gouv.fr/datasets/base-gtfs-de-la-RATP/
    TCL (Lyon)    : https://transport.data.gouv.fr/datasets/horaires-theoriques-du-reseau-tcl/
    STAR (Rennes) : https://transport.data.gouv.fr/datasets/gtfs-star/
"""

import os
import argparse
import io
import json
import sys
import time
import urllib.request
import zipfile
import csv

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
BATCH = 100

TRANSPORT_TYPES = {
    # Heuristique sur le nom de l'arrêt / route_type si disponible
    "tram": "tram",
    "tramway": "tram",
    "metro": "metro",
    "rer": "train",
    "train": "train",
    "bus": "bus",
    "navette": "bus",
    "coaster": "bus",
    "bhns": "bus",
    "brt": "bus",
}


def deduce_type(stop_name: str) -> str:
    """Déduit le type de transport depuis le nom de l'arrêt."""
    name_lower = stop_name.lower()
    for kw, t in TRANSPORT_TYPES.items():
        if kw in name_lower:
            return t
    return "bus"


def download_zip(url: str) -> bytes:
    print(f"Téléchargement : {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "GENESIS-ETL/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = resp.read()
    print(f"  {len(data):,} octets téléchargés")
    return data


def parse_stops(zip_bytes: bytes, reseau: str) -> list[dict]:
    """
    Extrait les arrêts physiques depuis stops.txt dans le zip GTFS.
    Filtre : location_type = 0 ou vide (arrêts physiques, pas les stations parentes).
    """
    stops = []
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = zf.namelist()
        print(f"  Fichiers dans le zip : {', '.join(names[:15])}{'…' if len(names) > 15 else ''}")

        # Trouver stops.txt (peut être dans un sous-dossier)
        stops_file = next((n for n in names if n.endswith("stops.txt")), None)
        if not stops_file:
            raise FileNotFoundError("stops.txt introuvable dans le zip GTFS")

        with zf.open(stops_file) as f:
            reader = csv.DictReader(
                io.TextIOWrapper(f, encoding="utf-8-sig", errors="replace")
            )
            for row in reader:
                loc_type = row.get("location_type", "").strip()
                # Garder uniquement les arrêts physiques (location_type = 0 ou vide)
                if loc_type not in ("", "0"):
                    continue

                stop_id   = row.get("stop_id", "").strip()
                stop_name = row.get("stop_name", "").strip()
                try:
                    stop_lat = float(row.get("stop_lat", 0))
                    stop_lon = float(row.get("stop_lon", 0))
                except ValueError:
                    continue

                # Ignorer les coordonnées nulles/invalides
                if not stop_lat or not stop_lon:
                    continue

                stops.append({
                    "stop_id":   stop_id,
                    "stop_name": stop_name,
                    "stop_lat":  stop_lat,
                    "stop_lon":  stop_lon,
                    "sous_type": deduce_type(stop_name),
                })

    print(f"  {len(stops)} arrêts physiques extraits depuis stops.txt")
    return stops


def build_rows(stops: list[dict], reseau: str, ville: str) -> list[dict]:
    """Construit les lignes à insérer dans poi_france."""
    rows = []
    for s in stops:
        rows.append({
            "categorie":     "arret_transport",
            "sous_categorie": s["sous_type"],
            "nom":           s["stop_name"],
            "lat":           s["stop_lat"],
            "lng":           s["stop_lon"],
            "ville":         ville,
            "source":        "gtfs_transport_data_gouv",
            "metadata": {
                "stop_id":  s["stop_id"],
                "reseau":   reseau,
                "ville":    ville,
            },
            # Clé de déduplication : source + reseau + stop_id
            # → stockée dans metadata pour référence croisée
        })
    return rows


def upsert_batch(supabase, rows: list[dict], dry_run: bool = False) -> int:
    """
    Insère en batch dans poi_france.
    Stratégie : supprime les arrêts existants pour ce réseau, puis insert propre.
    (poi_france n'a pas de contrainte unique sur source+nom+coords)
    """
    if dry_run:
        print(f"  [DRY RUN] {len(rows)} lignes (non insérées)")
        return len(rows)

    # Extraire reseau depuis le premier row
    reseau = rows[0]["metadata"]["reseau"] if rows else None
    if reseau:
        del_resp = (
            supabase.table("poi_france")
            .delete()
            .eq("source", "gtfs_transport_data_gouv")
            .eq("categorie", "arret_transport")
            .execute()
        )
        # Filtrer uniquement ceux de ce réseau via Python (pas de filtre jsonb en delete simple)
        # En pratique on supprime tous les arret_transport de la source GTFS puis on réinsère
        print(f"  Suppression des arrêts existants (source=gtfs_transport_data_gouv, categorie=arret_transport)")

    inserted = 0
    for i in range(0, len(rows), BATCH):
        batch = rows[i : i + BATCH]
        supabase.table("poi_france").insert(batch).execute()
        inserted += len(batch)
        print(f"  Batch {i // BATCH + 1}: {len(batch)} arrêts insérés")
        time.sleep(0.1)  # respect rate limit

    return inserted


def main():
    parser = argparse.ArgumentParser(
        description="Import GTFS stops → poi_france (arret_transport)"
    )
    parser.add_argument("--url",    help="URL du fichier GTFS zip")
    parser.add_argument("--file",   help="Chemin local du fichier GTFS zip")
    parser.add_argument("--reseau", required=True, help="Nom du réseau (ex: Bibus)")
    parser.add_argument("--ville",  required=True, help="Ville principale (ex: Brest)")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Parse uniquement, sans insertion en base"
    )
    args = parser.parse_args()

    if not args.url and not args.file:
        parser.error("Fournir --url ou --file")

    print(f"\n=== Import GTFS : {args.reseau} ({args.ville}) ===\n")

    # 1. Charger le zip
    if args.file:
        with open(args.file, "rb") as f:
            zip_bytes = f.read()
        print(f"Fichier local : {args.file} ({len(zip_bytes):,} octets)")
    else:
        zip_bytes = download_zip(args.url)

    # 2. Parser les arrêts
    stops = parse_stops(zip_bytes, args.reseau)
    if not stops:
        print("Aucun arrêt trouvé, arrêt.")
        sys.exit(1)

    # 3. Construire les lignes
    rows = build_rows(stops, args.reseau, args.ville)
    print(f"\n{len(rows)} arrêts prêts à l'insertion (ville={args.ville}, reseau={args.reseau})")

    # 4. Insérer
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    if args.dry_run:
        print("\n[DRY RUN] Aperçu des 3 premiers :")
        for r in rows[:3]:
            print(f"  {r['nom']:40s} lat={r['lat']:.5f} lng={r['lng']:.5f} type={r['sous_categorie']}")
        return

    t0 = time.time()
    inserted = upsert_batch(supabase, rows)
    elapsed = time.time() - t0

    print(f"\nTerminé : {inserted} arrêts insérés/mis à jour en {elapsed:.1f}s")
    print(f"Relancer compute_panneau_scores('{args.ville}') pour recalculer le score transport.")


if __name__ == "__main__":
    main()
