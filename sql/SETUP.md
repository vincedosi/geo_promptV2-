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
234_cloisonnement_organisations.sql -- Cloisonnement entre organisations : retire toute
                                    -- écriture PostgREST aux clients, visibilité des
                                    -- sources (socle/privee), ferme les USING (true)
235_affectation_sources.sql         -- Données : chaque source rendue à son propriétaire
238_politiques_for_all.sql          -- Plus aucune politique FOR ALL pour un client :
                                    -- éclatées en INSERT/UPDATE/DELETE (elles fuyaient
                                    -- en SELECT vers les admins d'espace)
```

> ⚠ **010 recrée des `USING (true)`** sur `isochrones_cache`, `saved_maps` et
> `panneaux_affichage` — des données de client. Si on le rejoue, il faut
> rejouer **234 puis 238 juste après**, sinon tout client connecté relit les données de
> tous par PostgREST avec la clé publique. `tests/integration/cloisonnement-rls.test.ts`
> le détecte.

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
| `global_ooh` | 005 | Data Lake panneaux OOH — **supprimée en 082** (fusionnée dans `panneaux_affichage`) |
| `import_runs_ooh` | 005 | Historique imports OOH |
| `calculation_jobs` | 013 | Jobs async couverture |
| `carreaux_2km` | migrations/034 | ~75k cellules 2km pré-agrégées |
| `carreaux_5km` | migrations/034 | ~17k cellules 5km pré-agrégées |
| `carreaux_1km` | migrations/044 | ~250k cellules 1km pré-agrégées (fix trous z10-12) |
| `france_borders` | (manuel) | MultiPolygon France — requis pour clip isochrones |
| `dsp_campaigns` | migrations/20260408 | Campagnes DSP (Adform, DV360…) |
| `dsp_campaign_data` | migrations/20260408 | Lignes d'impressions DSP (~280k/campagne), CASCADE |
| `postal_code_commune` | migrations/20260408 | Référentiel La Poste (~35k), peuplé via geo.api.gouv.fr |
| `espace_jeux_recommandes` | 251 | Sélection recommandée de jeux de la carte par espace (range, ne donne aucun droit ; ≤ 200 par espace) |
| `campagnes` | 261 | Campagne multi-média d'un espace (`organization_id`), clé de rejeu `cle_import` unique par espace — distincte de `dsp_campaigns` |
| `campagne_lignes` | 261 | Lignes d'une campagne, une par média (`digital`, `ooh`, `tv`, `radio`, `presse`), `unique (campagne_id, ordre)` |
| `campagne_ligne_panneaux` | 261 | Panneaux réservés par une ligne OOH ; `on delete restrict` côté panneau |
| `carreau_couverture` | 266 | Une ligne étroite par carreau Filosofi (2 324 577) : centroïde 3857, CP canonique, IRIS, commune, département, 24 effectifs `real[]` (ordre `rang_pop`) ; construite par `scripts/construire_carreau_couverture.mjs` (≈ 5 min, psql), exclue de la sauvegarde avec son journal |
| `carreau_couverture_bandes` | 266 | Journal des bandes de `carreau_couverture` ; `max(construit_le)` date la base pour le cache de couverture |
| `carreau_couverture_controle` | 268 | Certificat de complétude de `carreau_couverture` (une ligne : comptes de `carreaux_filosofi`, de la table et du journal), posé en fin de construction |

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
| `match_campaign_postal_to_iris()` | migrations/20260408 | Matching DSP postal → commune → IRIS |
| `get_dsp_campaign_stats()` | migrations/20260408 | Stats agrégées par campagne (COUNT FILTER) |
| `remplacer_jeux_recommandes()` | 251 | Remplace la sélection recommandée d'un espace en une transaction (jsonb `{cles}`, ≤ 200) |
| `campagne_ooh_jsonb()` | 263 | Campagne OOH d'un espace : campagne, lignes OOH, emplacements GeoJSON (jsonb, `null` hors espace, borne 20 000 + `tronque`) |
| `campagnes_ooh_jsonb()` | 263 | Campagnes d'un espace ayant une ligne OOH (jsonb, borne 200 + `tronque`) |
| `supprimer_panneaux_plan_de_source()` | 264 | Fonction du déclencheur `trg_data_sources_panneaux_plan` (BEFORE DELETE sur `data_sources`) : retire les panneaux `plan-ooh:%` de la source et leurs liens de campagne, sinon `set null` les rendrait visibles de tous |
| `construire_carreau_couverture()` | 266 | Construit UNE bande de longitude de `carreau_couverture` (une transaction, journalisée, rejouable : remplace) — psql uniquement |
| `vider_carreau_couverture()` | 266, 268 | Vide `carreau_couverture`, son journal ET son certificat (préalable de `--tout`) |
| `certifier_carreau_couverture()` | 268 | Compte `carreaux_filosofi`, la table et son journal ; range le certificat (≈ 0,3 s) |
| `carreau_couverture_complete()` | 268 | `NULL` si la table est certifiée complète, sinon le motif ; lu par la couverture et le dénominateur IRIS |
| `couverture_geometrie()` | 269 | Couverture d'une zone de l'espace (lecture seule, `jsonb`) : population de la cible telle quelle, ou par CP / IRIS avec la part de chaque territoire ; ≤ 100 000 km², ≤ 400 000 carreaux ; refuse sans table certifiée |
| `construire_denominateur_iris()` | 267 | Maille `iris` d'`unite_population_totale` construite depuis `carreau_couverture` (même règle que le numérateur, jamais `iris.population`) ; efface et réécrit la seule maille `iris`, ≈ 18 s |

---

## Rejouer sql/238 et sql/162 APRES sql/250

`sql/250` supprime la table `agent_chat_messages` (suppression de l'IA, 2026-10-12). Deux anciennes migrations la nomment encore et ECHOUENT si on les rejoue sur une base deja passee par 250 : `sql/238_politiques_for_all.sql` (`drop policy if exists agent_chat_org_read on public.agent_chat_messages` -> `relation does not exist`, le `if exists` ne couvre pas la table) et `sql/162` (index de `agent_chat_messages`, lignes 78-79). Une reconstruction dans l'ordre (162, puis 238, puis 250) passe. Pour rejouer 238 ou 162 sur une base deja a jour : sauter les instructions qui visent `agent_chat_messages` (les migrations ne sont pas modifiees, elles portent l'histoire de la base).

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
