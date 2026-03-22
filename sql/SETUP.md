# GEO.Prompt — Guide de setup base de données

## Deux systèmes de migration

| Dossier | Comment exécuter | Quand |
|---------|-----------------|-------|
| `sql/` | **Manuellement** dans le SQL Editor du Dashboard Supabase | Schéma, fonctions, sécurité |
| `supabase/migrations/` | Via **Supabase CLI** (`supabase db push`) ou Dashboard | Tiles MVT, tables pré-agrégées |

> Les scripts `sql/` ont un timeout de 30s via l'API REST — toujours utiliser le SQL Editor du Dashboard.

---

## Ordre d'exécution pour un setup complet (fresh DB)

Exécuter dans cet ordre exact depuis le SQL Editor Supabase :

### 1. Tables de base

```
001_unify_poi_table.sql              -- Table poi (renommage depuis poi_france) + index catégorie
002_import_datagouv.sql             -- Index source + RPC count_pois_by_source()
003_carreaux_filosofi.sql           -- Table carreaux_filosofi (2.3M lignes 200m, JSONB metadata)
005_global_ooh.sql                  -- Tables global_ooh + import_runs_ooh (Data Lake OOH)
013_calculation_jobs.sql            -- Table calculation_jobs + ENUM job_status (jobs async couverture)
```

### 2. Fonctions RPC utilitaires

```
003_carreaux_rpc.sql                -- RPC get_carreaux() — bbox queries sur carreaux_filosofi
004_get_table_sizes_function.sql    -- RPC get_table_sizes() — monitoring taille tables
004_scoring_rpc.sql                 -- RPC get_carreaux_for_scoring() — data démo pour outils IA
005_upsert_carreaux_batch.sql       -- RPC notify_pgrst_reload() — reload cache PostgREST
006_find_synergy_billboards.sql     -- RPC find_synergy_billboards() — synergie panneaux × POI
007_view_carreaux_filosofi.sql      -- Vue carreaux_filosofi (alias compatibilité outils IA)
```

### 3. Colonnes et index

```
016_add_geom_centroid_indexed.sql   -- Colonne geom_centroid indexée sur carreaux_filosofi
                                    -- ⚠ LONG (~5-10 min sur 2.3M lignes) — lancer en async
018_calculation_jobs_breakdown.sql  -- Colonne breakdown JSONB sur calculation_jobs
026_carreaux_filosofi_colonnes_directes.sql  -- Colonnes directes ind, ind_18_24... (plus JSONB)
```

### 4. Fonctions couverture audience

```
017_rpc_compute_coverage_fast.sql           -- RPC compute_coverage_fast() v1 (base)
025_rpc_compute_coverage_per_poi_batch_v2.sql -- RPC compute_coverage_per_poi_batch() v2
029_revert_coverage_fast_jsonb.sql          -- Revert compute_coverage_fast → JSONB (colonnes encore NULL)
035_fix_compute_coverage_fast_intersects.sql -- Fix bug bbox-only → ajoute ST_Intersects
043_plpgsql_loop_no_temptable.sql           -- RPC calculate_coverage_per_group() v4 (ACTIVE — sans temp table)
```

### 5. Fonction Bataille d'Isochrones

```
042_get_isochrone_battle_v9_outer_fill.sql  -- RPC get_isochrone_battle() v9 PALIER-ASC (ACTIVE)
                                            -- ⚠ Nécessite france_borders en DB (clip géographique)
```

### 6. Sécurité (TOUJOURS en dernier)

```
010_security_hardening.sql          -- RLS policies sur toutes les tables publiques
                                    -- ⚠ À rejouer après chaque nouvelle migration
```

---

## Migrations Supabase CLI (supabase/migrations/)

Exécuter via `supabase db push` ou manuellement dans le Dashboard :

```
006_carreaux_mvt_tile_server.sql    -- RPC get_tile_mvt(z,x,y) — serveur tuiles MVT
007_carreaux_mvt_optimized.sql      -- MVT optimisé (zoom-level filtering, adaptive limits)
008_carreaux_multiresolution.sql    -- Vues matérialisées 1km/5km + RPC sélection dynamique
034_populate_carreaux_preaggregate.sql -- ⚠ LONG (~5-10 min) — peuple carreaux_2km + carreaux_5km
                                       -- Exécuter dans SQL Editor, pas via API REST
035_get_tile_multiresolution.sql       -- Ancienne version get_tile (supersédée par 043+045)
043_get_tile_geom_3857.sql             -- get_tile optimisé geom_3857 pré-calculé (z>=10: 200m)
044_carreaux_1km.sql                   -- ⚠ LONG (~2-5 min) — table carreaux_1km agrégée depuis 200m
                                       -- Exécuter dans SQL Editor
045_update_get_tile.sql                -- Nouveaux paliers : z>=13: 200m | z10-12: 1km | z8-9: 2km | z6-7: 5km
                                       -- ⚠ Exécuter APRÈS 043 + 044
```

---

## Tables créées (état final)

| Table | Script | Description |
|-------|--------|-------------|
| `poi` | 001 | Points d'intérêt |
| `carreaux_filosofi` | 003 | 2.3M carreaux INSEE 200m |
| `global_ooh` | 005 | Data Lake panneaux OOH |
| `import_runs_ooh` | 005 | Historique imports OOH |
| `calculation_jobs` | 013 | Jobs async couverture |
| `carreaux_2km` | migrations/034 | ~75k cellules 2km pré-agrégées |
| `carreaux_5km` | migrations/034 | ~17k cellules 5km pré-agrégées |
| `carreaux_1km` | migrations/044 | ~250k cellules 1km pré-agrégées (fix trous z10-12) |
| `france_borders` | (manuel) | MultiPolygon France — requis pour clip isochrones |

## Fonctions RPC actives (état final)

| Fonction | Script | Description |
|----------|--------|-------------|
| `get_isochrone_battle()` | 042_v9 | Bataille Isochrones — palier-ASC, raw rings |
| `calculate_coverage_per_group()` | 043 | Couverture dédupliquée par groupe (ST_UnaryUnion) |
| `compute_coverage_fast()` | 035 | Couverture rapide (JSONB, ST_Intersects) |
| `compute_coverage_per_poi_batch()` | 025 | Couverture par POI (PL/pgSQL loop) |
| `get_carreaux()` | 003_rpc | Carreaux par bbox |
| `get_carreaux_for_scoring()` | 004 | Données démo pour outils IA |
| `find_synergy_billboards()` | 006 | Synergie panneaux × POI × démo |
| `get_tile()` | migrations/045 | Tuiles MVT multi-res : z>=13: 200m, z10-12: 1km, z8-9: 2km, z6-7: 5km |
| `get_table_sizes()` | 004 | Tailles des tables (monitoring) |
| `notify_pgrst_reload()` | 005_upsert | Reload cache PostgREST |

---

## Dossier archive/

Les scripts dans `sql/archive/` sont des **versions intermédiaires déjà appliquées** en production, conservées pour référence historique uniquement. Ne pas les réappliquer.

Contenu :
- `setup_carreaux.sql` — supersédé par 003_carreaux_filosofi
- `002_get_carreaux_bbox.sql` — supersédé par 003_carreaux_rpc
- `033` à `041` battle v2→v8 — supersédés par v9 (042)
- `034_calculate_coverage_per_group.sql` + `041_optimize` + `042_cte` — supersédés par 043
- `027` + `028` — revertés par 029
- `031` + `032` — supersédés par 033+
- `006_import_carreaux_batch.sql` — log d'import, pas un script SQL
- `019_rpc_compute_coverage_per_poi_v2.sql` — supersédé par 025
