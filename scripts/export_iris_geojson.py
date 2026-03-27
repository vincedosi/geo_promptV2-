#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Export IRIS → iris_france.geojson (FeatureCollection)

Usage (depuis la racine du projet) :
    python scripts/export_iris_geojson.py

Prérequis :
    pip install requests  (ou httpx)

Lit NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY depuis .env.local.
Utilise l'API REST Supabase (HTTPS) via la RPC export_iris_batch.
Écrit iris_france.geojson à la racine du projet.
"""

import json
import os
import sys
import time

try:
    import requests
except ImportError:
    print("Erreur : requests manquant. Lance : pip install requests")
    sys.exit(1)

OUT = "iris_france.geojson"
BATCH = 2000


# ── Lecture .env.local ────────────────────────────────────────────────────────
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


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    supabase_url, service_key = get_config()
    rpc_url = f"{supabase_url}/rest/v1/rpc/export_iris_batch"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }

    print(f"[export] Connexion à {supabase_url} via REST API...")

    features = []
    offset = 0
    t0 = time.time()

    while True:
        resp = requests.post(
            rpc_url,
            headers=headers,
            json={"p_offset": offset, "p_limit": BATCH},
            timeout=60,
        )
        if resp.status_code != 200:
            print(f"\nErreur HTTP {resp.status_code}: {resp.text[:500]}")
            sys.exit(1)

        rows = resp.json()
        if not rows:
            break

        for row in rows:
            features.append({
                "type": "Feature",
                "geometry": json.loads(row["geometry"]),
                "properties": {
                    "code_iris":      row["code_iris"],
                    "nom_iris":       row["nom_iris"],
                    "type_iris":      row["type_iris"],
                    "population":     int(row["population"])     if row["population"]     is not None else 0,
                    "pop_0_14":       float(row["pop_0_14"])     if row["pop_0_14"]       is not None else 0,
                    "pop_15_29":      float(row["pop_15_29"])    if row["pop_15_29"]      is not None else 0,
                    "pop_30_44":      float(row["pop_30_44"])    if row["pop_30_44"]      is not None else 0,
                    "pop_45_59":      float(row["pop_45_59"])    if row["pop_45_59"]      is not None else 0,
                    "pop_60_74":      float(row["pop_60_74"])    if row["pop_60_74"]      is not None else 0,
                    "pop_75_plus":    float(row["pop_75_plus"])  if row["pop_75_plus"]    is not None else 0,
                    "nb_csp_cadre":   float(row["nb_csp_cadre"])   if row["nb_csp_cadre"]   is not None else 0,
                    "nb_csp_employe": float(row["nb_csp_employe"]) if row["nb_csp_employe"] is not None else 0,
                    "nb_csp_ouvrier": float(row["nb_csp_ouvrier"]) if row["nb_csp_ouvrier"] is not None else 0,
                },
            })

        offset += len(rows)
        elapsed = time.time() - t0
        print(f"  {offset:,} IRIS récupérés — {elapsed:.0f}s", end="\r")

        if len(rows) < BATCH:
            break

    print(f"\n[export] {offset:,} IRIS — Écriture {OUT}...")
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f, ensure_ascii=False, separators=(",", ":"))

    size_mb = os.path.getsize(OUT) / 1024 / 1024
    print(f"[export] OK — {offset:,} IRIS — {size_mb:.0f} MB — {time.time()-t0:.0f}s")
    print(f"\nEtape suivante (WSL) :")
    print(f"  tippecanoe -o public/iris_france.pmtiles -Z5 -z14 -l iris \\")
    print(f"    --no-feature-limit --no-tile-size-limit \\")
    print(f"    --coalesce-densest-as-needed --extend-zooms-if-still-dropping \\")
    print(f"    iris_france.geojson")


if __name__ == "__main__":
    main()
