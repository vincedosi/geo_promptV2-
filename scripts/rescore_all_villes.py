# -*- coding: utf-8 -*-
"""Rescore toutes les villes via compute_panneau_scores()."""
import time
from supabase import create_client

SUPABASE_URL = "https://vkkdbygwbrxyogqosten.supabase.co"
SUPABASE_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZra2RieWd3YnJ4eW9ncW9zdGVuIiwicm9sZSI"
    "6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTE4OTk2MCwiZXhwIjoyMDg2NzY1OTYwfQ"
    ".hZQcgjx8AbkDF6o1oETQYURnQB9hHi7p0nuXKFjyFrU"
)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Récupère la liste des villes distinctes
res = supabase.table("panneaux_affichage").select("ville").execute()
villes = sorted(set(r["ville"] for r in res.data if r.get("ville")))
print(f"Total villes : {len(villes)}\n")

errors = []
for i, ville in enumerate(villes, 1):
    try:
        r = supabase.rpc("compute_panneau_scores", {"p_ville": ville}).execute()
        nb = r.data if r.data else 0
        print(f"[{i:3d}/{len(villes)}] {ville:40s} → {nb} panneaux")
    except Exception as e:
        print(f"[{i:3d}/{len(villes)}] {ville:40s} ERREUR: {e}")
        errors.append(ville)
    time.sleep(0.1)

print(f"\nTerminé. Erreurs : {errors}")
