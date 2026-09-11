# -*- coding: utf-8 -*-
"""Rescore toutes les villes via compute_panneau_scores()."""
import os
import time
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
