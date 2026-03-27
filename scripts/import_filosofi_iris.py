#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Import Filosofi IRIS → rev_median dans public.iris

Usage :
    python3 scripts/import_filosofi_iris.py /chemin/vers/BASE_TD_FILO_IRIS_2021_DEC.csv

Lit NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY depuis .env.local.
Met à jour la colonne rev_median dans public.iris via l'API REST Supabase.
"""

import csv
import json
import os
import sys
import time

try:
    import requests
except ImportError:
    print("Erreur : requests manquant. Lance : pip install requests")
    sys.exit(1)

BATCH = 200


def load_env_file() -> dict:
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    search_dirs = list(dict.fromkeys([os.getcwd(), project_root]))
    for env_name in (".env.local", ".env"):
        env_file = next(
            (os.path.join(d, env_name) for d in search_dirs if os.path.exists(os.path.join(d, env_name))),
            None,
        )
        if not env_file:
            continue
        result = {}
        with open(env_file, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                result[k.strip()] = v.strip().strip('"').strip("'")
        if result:
            return result
    return {}


def get_config() -> tuple[str, str]:
    env = {**load_env_file(), **os.environ}
    url = env.get("NEXT_PUBLIC_SUPABASE_URL", "")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        print("Erreur : NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant dans .env.local")
        sys.exit(1)
    return url.rstrip("/"), key


def main():
    if len(sys.argv) < 2:
        print("Usage : python3 scripts/import_filosofi_iris.py /chemin/vers/BASE_TD_FILO_IRIS_2021_DEC.csv")
        sys.exit(1)

    csv_path = sys.argv[1]
    if not os.path.exists(csv_path):
        print(f"Erreur : fichier introuvable : {csv_path}")
        sys.exit(1)

    supabase_url, service_key = get_config()
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }
    upsert_url = f"{supabase_url}/rest/v1/iris?on_conflict=code_iris"

    print(f"[import] Lecture de {os.path.basename(csv_path)}...")

    # Détection séparateur (point-virgule dans les fichiers INSEE)
    with open(csv_path, encoding="utf-8-sig") as f:
        sample = f.read(2048)
    sep = ";" if sample.count(";") > sample.count(",") else ","

    rows = []
    skipped = 0
    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f, delimiter=sep)
        # Affiche les colonnes disponibles au premier passage
        first = True
        for row in reader:
            if first:
                print(f"[import] Colonnes détectées : {list(row.keys())[:12]}...")
                first = False

            code_iris = row.get("IRIS", "").strip()
            med_raw   = row.get("MED21", "").strip().replace(",", ".")

            if not code_iris or not med_raw or med_raw in ("", "s", "nd", "NS"):
                skipped += 1
                continue

            try:
                rev_median = float(med_raw)
            except ValueError:
                skipped += 1
                continue

            rows.append({"code_iris": code_iris, "rev_median": rev_median})

    print(f"[import] {len(rows):,} lignes valides, {skipped:,} ignorées (secret INSEE / vide)")

    # Envoi par batch
    t0 = time.time()
    done = 0
    errors = 0
    for i in range(0, len(rows), BATCH):
        batch = rows[i:i + BATCH]
        resp = requests.post(upsert_url, headers=headers, data=json.dumps(batch), timeout=30)
        if resp.status_code not in (200, 201):
            errors += 1
            print(f"\n! Erreur batch {i//BATCH} : HTTP {resp.status_code} — {resp.text[:200]}")
        done += len(batch)
        print(f"  {done:,} / {len(rows):,} ({100*done//len(rows)}%) — {time.time()-t0:.0f}s", end="\r")

    elapsed = time.time() - t0
    print(f"\n[import] OK — {done:,} IRIS mis à jour, {errors} erreurs — {elapsed:.0f}s")
    if errors:
        print("[import] Vérifie les erreurs ci-dessus.")


if __name__ == "__main__":
    main()
