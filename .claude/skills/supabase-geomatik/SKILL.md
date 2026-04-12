---
name: supabase-geomatik
description: >
  Configuration Supabase pour GEOMATIK : RLS policies, PostGIS RPCs, auth patterns,
  migrations, MCP tools. Utilise cette skill pour tout travail sur la sécurité RLS,
  les fonctions PostGIS, les migrations SQL, l'authentification Supabase, les policies,
  ou quand le prompt mentionne RLS, policy, migration, PostGIS, RPC, auth, ou Supabase.
---

# Supabase — GEOMATIK

## Accès

- Projet : `vkkdbygwbrxyogqosten` (eu-west-3)
- Compute : **Nano** (250 IOPS, 5 MB/s, burst 30 min/jour)
- Toujours utiliser MCP Supabase (`execute_sql`, `apply_migration`)
- JAMAIS demander à l'utilisateur de lancer du SQL manuellement

## Auth patterns

```
Routes API (/api/*) → getSession()  — JWT local, ZÉRO appel réseau
Pages (/map, /dashboard…) → getUser() — un appel par navigation
```

- `createAdminClient()` depuis `@/lib/auth` pour les routes API
- ⛔ JAMAIS `getUser()` sur routes API → 409 token refresh concurrent → déconnexion
- Signup désactivé, rate limits abaissés
- TODO : Cloudflare Turnstile CAPTCHA sur auth

## RLS — État actuel

**35 tables avec RLS désactivé** — fix en attente (script SQL généré).

### Pattern RLS standard GEOMATIK

```sql
-- Lecture : tous les users authentifiés
CREATE POLICY "select_authenticated" ON table_name
  FOR SELECT TO authenticated USING (true);

-- Écriture : admins uniquement (via metadata)
CREATE POLICY "insert_admin" ON table_name
  FOR INSERT TO authenticated
  WITH CHECK (auth.jwt() ->> 'role' = 'admin');

-- Update/Delete : même pattern admin
```

### Tables critiques à protéger en priorité

1. `panneaux` — données client sensibles
2. `iris` — données INSEE (lecture seule pour non-admins)
3. `dsp_campaign_data` — données campagnes clients
4. `scoring_profiles` — profils de scoring custom
5. `scoring_results` — résultats de scoring

## PostGIS RPCs — Inventaire

| RPC | Usage | ⚠ Modifiable ? |
|-----|-------|----------------|
| `get_isochrone_battle` | Calcul battle territorial | ⛔ NON |
| `clip_geojson_to_france` | Découpe GeoJSON aux frontières | ⛔ NON |
| `clip_rings_to_france` | Découpe anneaux isochrones | ⛔ NON |
| `compute_panneau_scores_v2` | Scoring paramétrique OOH | ⚠ Avec prudence |
| `match_campaign_postal_to_iris` | Matching postal → IRIS | ✅ OUI |
| `get_dsp_campaign_stats` | Stats campagnes agrégées | ✅ OUI |

## Migrations

- Fichier de référence : `sql/SETUP.md`
- Utiliser `apply_migration` via MCP (pas de SQL manuel)
- Toujours tester avec `EXPLAIN ANALYZE` avant d'appliquer
- Index GIST obligatoire sur toute colonne géométrie

## Contraintes Nano — Rappel

- Max 3 requêtes parallèles
- Bbox viewport seulement, jamais France entière
- Batch insert par 50 max
- Pas de full table scan sur iris (51k) ou carreaux_filosofi (2.3M)
