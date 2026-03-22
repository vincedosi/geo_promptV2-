# -*- coding: utf-8 -*-
"""
Import IRIS INSEE depuis fichiers locaux (millésime 2022, format P22_).
Lit data/iris/base-ic-evol-struct-pop-2022.CSV et met à jour la table iris.

Usage :
    python -X utf8 scripts/import_iris_local.py
    python -X utf8 scripts/import_iris_local.py --dry-run
    python -X utf8 scripts/import_iris_local.py --dept 29
"""

import argparse
import csv
import os
import sys
import time

from supabase import create_client

SUPABASE_URL = "https://vkkdbygwbrxyogqosten.supabase.co"
SUPABASE_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZra2RieWd3YnJ4eW9ncW9zdGVuIiwicm9sZSI"
    "6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTE4OTk2MCwiZXhwIjoyMDg2NzY1OTYwfQ"
    ".hZQcgjx8AbkDF6o1oETQYURnQB9hHi7p0nuXKFjyFrU"
)

BATCH = 500

# Répertoire des fichiers locaux (relatif à la racine du projet)
DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "iris")

# Mapping colonnes CSV 2022 → colonnes table iris
POP_FILE = "base-ic-evol-struct-pop-2022.CSV"

COL_MAP = {
    # Population totale → colonne existante
    "P22_POP":    "population",
    # Tranches d'âge
    "P22_POP0014": "pop_0_14",
    "P22_POP1529": "pop_15_29",
    "P22_POP3044": "pop_30_44",
    "P22_POP4559": "pop_45_59",
    "P22_POP6074": "pop_60_74",
    "P22_POP75P":  "pop_75_plus",
    # Note : P22_PMEN = population des ménages ≠ nombre de ménages → pas mappé
    # CSP (valeurs pondérées INSEE → entier arrondi)
    "C22_POP15P_STAT_GSEC13_23": "nb_csp_cadre",    # Cadres & prof. intellectuelles
    "C22_POP15P_STAT_GSEC15_25": "nb_csp_employe",  # Employés
    "C22_POP15P_STAT_GSEC16_26": "nb_csp_ouvrier",  # Ouvriers
}


def safe_int(val: str) -> int | None:
    """Convertit une valeur INSEE (float str avec virgule) en int arrondi."""
    v = val.strip().replace(",", ".")
    if not v or v in ("s", "ns", "NS", "nd", "ND", ""):
        return None
    try:
        return round(float(v))
    except (ValueError, TypeError):
        return None


def dept_from_commune(com: str) -> str:
    """Déduit le code département depuis le code commune INSEE."""
    if com.startswith("97"):  # DOM (971-976)
        return com[:3]
    return com[:2]


def parse_pop_file(filepath: str, dept_filter: str | None) -> list[dict]:
    """Lit le fichier population et retourne les rows pour upsert."""
    rows = []
    with open(filepath, encoding="latin-1", errors="replace", newline="") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            code_iris = row.get("IRIS", "").strip()
            if len(code_iris) != 9:
                continue

            com        = row.get("COM", "").strip()
            dept       = dept_from_commune(com) if com else ""

            if dept_filter and not dept.startswith(dept_filter):
                continue

            # Colonnes identité (requises pour INSERT si l'IRIS n'existe pas encore)
            record: dict = {
                "code_iris":    code_iris,
                "code_commune": com,
                "code_dept":    dept,
                "nom_iris":     row.get("LAB_IRIS", "").strip(),
                "type_iris":    row.get("TYP_IRIS", "").strip(),
            }

            # Colonnes démographiques
            for csv_col, db_col in COL_MAP.items():
                val = safe_int(row.get(csv_col, ""))
                if val is not None:
                    record[db_col] = val

            rows.append(record)

    return rows


def upsert_batch(supabase, rows: list[dict], dry_run: bool) -> int:
    if dry_run:
        print(f"[DRY RUN] {len(rows)} IRIS (non écrits)")
        print("  Aperçu :")
        for r in rows[:3]:
            print(f"    {r['code_iris']} — pop={r.get('population')} 0-14={r.get('pop_0_14')} 15-29={r.get('pop_15_29')} menages={r.get('nb_menages')}")
        return len(rows)

    inserted = 0
    for i in range(0, len(rows), BATCH):
        batch = rows[i: i + BATCH]
        supabase.table("iris").upsert(batch, on_conflict="code_iris").execute()
        inserted += len(batch)
        pct = round(inserted / len(rows) * 100)
        print(f"  [{pct:3d}%] {inserted}/{len(rows)} IRIS mis à jour (batch {i//BATCH + 1})", end="\r")
        time.sleep(0.02)

    print()
    return inserted


def main():
    parser = argparse.ArgumentParser(description="Import IRIS local 2022 → Supabase")
    parser.add_argument("--dept", help="Filtre dept (ex: 29, 75). Vide = tous.")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    dept_filter = args.dept.zfill(2) if args.dept else None

    pop_path = os.path.join(DATA_DIR, POP_FILE)
    if not os.path.exists(pop_path):
        print(f"ERREUR : fichier introuvable : {pop_path}")
        sys.exit(1)

    print(f"\n=== Import IRIS INSEE 2022 (dept={dept_filter or 'tous'}) ===")
    print(f"  Fichier : {pop_path}")

    rows = parse_pop_file(pop_path, dept_filter)
    print(f"  {len(rows)} IRIS extraits")

    if not rows:
        print("Aucune donnée, arrêt.")
        sys.exit(1)

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    t0 = time.time()
    n = upsert_batch(supabase, rows, args.dry_run)
    elapsed = time.time() - t0

    if not args.dry_run:
        print(f"\nTerminé : {n} IRIS mis à jour en {elapsed:.1f}s")
    else:
        print(f"\n[DRY RUN] {n} IRIS auraient été mis à jour.")


if __name__ == "__main__":
    main()
