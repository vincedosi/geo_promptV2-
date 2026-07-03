# DATABASE.md — Schéma complet Supabase GENESIS

> Projet : **GENESIS** (`vkkdbygwbrxyogqosten`) — région `eu-west-3`
> PostgreSQL 17.6 + PostGIS
> Généré le : 2026-03-20

---

## Sommaire

1. [Tables](#tables)
2. [Vues](#vues)
3. [RPC / Fonctions métier](#rpc--fonctions-métier)
4. [Triggers](#triggers)
5. [Index PostGIS & performance](#index-postgis--performance)
6. [RLS — Politiques de sécurité](#rls--politiques-de-sécurité)
7. [Notes importantes](#notes-importantes)

---

## Tables

### `poi_france` — Points d'intérêt (table principale)

> Vue `poi_france` maintenue pour compatibilité — inserts via la vue fonctionnent grâce au trigger `auto_set_geom`.

| Colonne | Type | Nullable | Défaut | Notes |
|---------|------|----------|--------|-------|
| `id` | uuid | NOT NULL | `uuid_generate_v4()` | PK |
| `geom` | geometry | NOT NULL | — | Auto-calculé depuis lat/lng (trigger) |
| `lat` | double precision | NOT NULL | — | |
| `lng` | double precision | NOT NULL | — | |
| `categorie` | text | NOT NULL | — | FK → `poi_categories.categorie` |
| `sous_categorie` | text | nullable | — | |
| `nom` | text | nullable | — | |
| `adresse` | text | nullable | — | |
| `ville` | text | nullable | — | |
| `departement` | text | nullable | — | |
| `code_departement` | text | nullable | — | |
| `region` | text | nullable | — | |
| `code_postal` | text | nullable | — | |
| `source` | text | nullable | `'data.gouv'` | |
| `date_import` | timestamptz | nullable | `now()` | |
| `metadata` | jsonb | nullable | `'{}'` | Propriétés brutes source |
| `data_source_id` | uuid | nullable | — | FK → `data_sources.id` |
| `organization_id` | uuid | nullable | `'00000000-...-0001'` | FK → `organizations.id` |
| `needs_clustering` | boolean | nullable | `true` | Flag pour reclusteriser |

**Index :** `geom` (GIST), `categorie`, `categorie+source`, `data_source_id`, `organization_id`, `region`, `code_departement`, `sous_categorie`

---

### `panneaux_affichage` — Table unique panneaux OOH/DOOH (toutes régies)

> Source de vérité unique depuis 2026-07-02 (`sql/082_consolidation_panneaux.sql`) :
> `global_ooh` a été fusionnée ici puis supprimée. Lue par la carte (`/api/map/ooh`),
> les outils IA du copilote et le scoring (6 RPC). Toujours filtrer `.eq('actif', true)`.
> Colonnes d'identité héritées de global_ooh : `source`, `source_ref` (OBJECTID ArcGIS),
> `adresse`, `code_insee`, `nb_faces`, `metadata`, `date_import`, `date_maj`.
> UNIQUE `(source, source_ref)` → upsert idempotent au ré-import ArcGIS.

| Colonne | Type | Nullable | Défaut |
|---------|------|----------|--------|
| `id` | uuid | NOT NULL | `uuid_generate_v4()` |
| `geom` | geometry | NOT NULL | Auto-calculé (trigger) |
| `lat` / `lng` | double precision | NOT NULL | — |
| `reference_panneau` | text | nullable | — |
| `regie` | text | nullable | — |
| `type_panneau` | text | nullable | — |
| `ville` / `departement` / `code_departement` / `region` / `code_postal` | text | nullable | — |
| `actif` | boolean | nullable | `true` |
| `score_age_0_14` … `score_age_65_plus` | double precision | nullable | — | Scores audiométrique Filosofi |
| `densite_population` | double precision | nullable | — |
| `revenu_median` | double precision | nullable | — |
| `nb_menages` | integer | nullable | — |
| `nb_lycees_500m` / `nb_lycees_1000m` | integer | nullable | `0` |
| `poi_lycee_distance_min` | double precision | nullable | — |
| `nb_poi_salle_sport_500m` / `nb_poi_gare_500m` / `nb_poi_supermarche_500m` | integer | nullable | `0` |
| `date_enrichissement` | timestamptz | nullable | — |
| `enrichissement_complet` | boolean | nullable | `false` |
| `data_source_id` | uuid | nullable | — |
| `organization_id` | uuid | nullable | `'00000000-...-0001'` |

**Index :** `geom` (GIST), `actif`, `regie`, `region`, `code_departement`, `data_source_id`, `organization_id`, `score_age_15_29`, `poi_lycee_distance_min`, `nb_lycees_500m`, UNIQUE `(reference_panneau, regie)`

---

### `isochrones_cache` — Cache isochrones ORS

| Colonne | Type | Nullable | Défaut | Notes |
|---------|------|----------|--------|-------|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PK |
| `cache_key` | text | NOT NULL | — | UNIQUE. Format : `ville_categorie_Xmin_mode` |
| `ville` | text | NOT NULL | — | |
| `categorie` | text | nullable | — | |
| `minutes` | integer | NOT NULL | — | |
| `mode` | text | NOT NULL | `'walk'` | `walk / drive / bike` |
| `geojson` | jsonb | NOT NULL | — | FeatureCollection ORS brute |
| `poi_count` | integer | nullable | `0` | |
| `created_at` | timestamptz | nullable | `now()` | |
| `geom` | geometry | nullable | — | Union géom (trigger) |
| `geom_simplified` | geometry | nullable | — | Version simplifiée |

**Index :** `cache_key` (x2), `geom` (GIST), `geom_simplified` (GIST)

---

### `carreaux_filosofi` — Carroyage INSEE 200m (2,3M lignes, 1,6 GB)

| Colonne | Type | Nullable | Défaut | Notes |
|---------|------|----------|--------|-------|
| `id` | bigint | NOT NULL | séquence | PK |
| `idcar` | text | NOT NULL | — | ID INSEE du carreau |
| `resolution` | text | NOT NULL | `'200m'` | |
| `millesime` | text | NOT NULL | `'2021'` | |
| `geom` | geometry | nullable | — | Polygone EPSG:4326 |
| `metadata` | jsonb | nullable | — | |
| `created_at` | timestamptz | nullable | `now()` | |
| `geom_centroid` | geometry | nullable | — | Centroïde pré-calculé |
| `ind` | numeric | nullable | — | Population totale |
| `ind_18_24` / `ind_25_39` / `ind_40_54` | numeric | nullable | — | Tranches d'âge |
| `ind_inc` | numeric | nullable | — | Pop. inconnue (secret stat) |

**Index :** `geom` (GIST), `geom_centroid` (GIST), `geom+resolution` (GIST INCLUDE), `resolution+millesime`, `resolution`, `idcar+resolution+millesime` (UNIQUE)

---

### `carreaux_2km` — Carreaux agrégés 2km (~75k lignes)

| Colonne | Type | Notes |
|---------|------|-------|
| `id` | text NOT NULL | PK, ex: `CRS2KM_N2170000E0430000` |
| `geom` | geometry NOT NULL | Polygone 2×2 km |
| `ind` / `men` | numeric | Population / Ménages |
| `ind_0_3` … `ind_80p` | numeric | Tranches d'âge détaillées |
| `ind_inc` / `ind_snv` | numeric | Inconnue / Sans revenu |
| `men_pauv` / `men_1ind` / `men_5ind` | numeric | |
| `men_prop` / `men_fmp` | numeric | Propriétaires / Familles mono-parentales |
| `men_mais` / `men_coll` / `men_surf` | numeric | Maisons / Collectif / Surface moy. |
| `log_av45` / `log_45_70` / `log_70_90` / `log_ap90` | numeric | Logements par époque |
| `log_soc` / `log_inc` | numeric | Sociaux / Inconnus |

**Index :** `geom` (GIST)

---

### `carreaux_5km` — Carreaux agrégés 5km (~17k lignes)

Mêmes colonnes que `carreaux_2km`. Utilisé pour zoom ≤ 7.

**Index :** `geom` (GIST)

---

### `organizations` — Multi-tenant

| Colonne | Type | Notes |
|---------|------|-------|
| `id` | uuid NOT NULL | PK, `gen_random_uuid()` |
| `name` | text NOT NULL | |
| `slug` | text NOT NULL | UNIQUE |
| `logo_url` | text | nullable |
| `created_at` / `updated_at` | timestamptz | `now()` |

---

### `profiles` — Profils utilisateurs

| Colonne | Type | Notes |
|---------|------|-------|
| `id` | uuid NOT NULL | PK = `auth.uid()` — FK → `auth.users.id` |
| `email` | text NOT NULL | |
| `full_name` | text | nullable |
| `role` | text NOT NULL | `'client'` — valeurs : `super_admin / admin / client` |
| `organization_id` | uuid | nullable — FK → `organizations.id` |
| `avatar_url` | text | nullable |
| `created_at` / `updated_at` | timestamptz | `now()` |

---

### `data_sources` — Sources de données importées

| Colonne | Type | Notes |
|---------|------|-------|
| `id` | uuid NOT NULL | PK |
| `organization_id` | uuid | FK → `organizations.id` |
| `name` / `description` | text | |
| `type` | text NOT NULL | `poi / panneaux / carreaux / filosofi` |
| `category` / `regie` | text | nullable |
| `original_filename` / `file_format` | text | nullable |
| `row_count` / `valid_count` / `error_count` | integer | `0` |
| `mapping` | jsonb | `'{}'` — mapping colonnes source → cible |
| `geo_config` | jsonb | `'{}'` — config géolocalisation |
| `ai_summary` | text | nullable |
| `import_date` | timestamptz | `now()` |
| `imported_by` | uuid | FK → `profiles.id` |
| `status` | text | `'active'` — valeurs : `active / deleted` |
| `shared_with` | uuid[] | `'{}'` — orgs avec accès partagé |
| `metadata` | jsonb | `'{}'` |
| `filter_fields` | text[] | nullable |

**Index :** `organization_id`, `status`

---

### `saved_maps` — Analyses géospatiales sauvegardées

| Colonne | Type | Notes |
|---------|------|-------|
| `id` | uuid NOT NULL | PK |
| `name` | text NOT NULL | |
| `ville` | text | nullable |
| `nb_pois` | integer | `0` |
| `zone_data` | jsonb | nullable — ZoneData complet |
| `carreaux_config` | jsonb | nullable |
| `isochrone_data` | jsonb | nullable |
| `messages` | jsonb | `'[]'` — historique chat |
| `created_at` / `updated_at` | timestamptz | `now()` |

**Index :** `created_at DESC`

---

### `calculation_jobs` — Jobs de calcul couverture

| Colonne | Type | Notes |
|---------|------|-------|
| `id` | uuid NOT NULL | PK |
| `user_id` | uuid | FK → `profiles.id` |
| `target_column` | text NOT NULL | `'ind'` — colonne Filosofi cible |
| `poi_count` | integer | `0` |
| `isochrone_duration` | integer | `30` (minutes) |
| `mode` | text | `'drive'` |
| `status` | job_status (ENUM) | `'pending'` — `pending / running / done / error` |
| `progress` | integer | `0` — pourcentage |
| `result` | numeric | nullable — résultat final |
| `error_message` | text | nullable |
| `created_at` / `updated_at` | timestamptz | NOT NULL, `now()` |
| `geometries` | text[] | nullable — GeoJSON strings |
| `geometry` | text | nullable |
| `breakdown` | jsonb | nullable — détail par tranche |

---

### `import_runs_ooh` — Historique imports OOH ArcGIS

| Colonne | Type | Notes |
|---------|------|-------|
| `id` | uuid NOT NULL | PK |
| `source` | text NOT NULL | Clé source (ex: `arcgis_brest_metropole`) |
| `url` | text | nullable |
| `lance_le` | timestamptz | `now()` |
| `termine_le` | timestamptz | nullable |
| `statut` | text | `'running'` — `running / done / error` |
| `nb_total` / `nb_inseres` / `nb_maj` / `nb_doublons` / `nb_erreurs` | integer | `0` |
| `erreurs` | jsonb | `'[]'` — messages d'erreur (max 50) |

---

### `isochrone_carreaux_coverage` — Table de jonction iso × carreaux

| Colonne | Type | Notes |
|---------|------|-------|
| `poi_id` | uuid NOT NULL | PK composée |
| `minutes` | integer NOT NULL | PK |
| `mode` | text NOT NULL | PK |
| `carreau_id` | bigint NOT NULL | PK — FK → `carreaux_filosofi.id` |

---

### `clustering_models` — Modèles K-Means entraînés

| Colonne | Type | Notes |
|---------|------|-------|
| `id` | integer NOT NULL | PK (séquence) |
| `version` | integer NOT NULL | UNIQUE |
| `k` | integer NOT NULL | Nombre de clusters |
| `silhouette_score` | numeric | nullable |
| `n_pca_components` / `variance_explained` | integer / numeric | nullable |
| `feature_names` | jsonb NOT NULL | Variables utilisées |
| `scaler_mean` / `scaler_scale` | jsonb NOT NULL | StandardScaler params |
| `pca_components` / `pca_mean` | jsonb NOT NULL | PCA params |
| `centroids` / `cluster_labels` / `cluster_avg_profiles` | jsonb NOT NULL | Résultats |
| `n_poi_trained` | integer | nullable |
| `duration_minutes` | integer NOT NULL | `60` |
| `mode` | text NOT NULL | `'drive'` |
| `created_at` | timestamptz | `now()` |
| `cluster_mapping_from_previous` | jsonb | nullable — migration entre versions |
| `feature_themes` | text[] | nullable |

---

### `clustering_jobs` — Jobs d'entraînement clustering

| Colonne | Type | Notes |
|---------|------|-------|
| `id` | uuid NOT NULL | PK |
| `status` | text NOT NULL | `'pending'` — `pending / running / done / error` |
| `poi_types` | text[] NOT NULL | Types POI à clusteriser |
| `geo_filter` / `params` | jsonb | nullable |
| `started_at` | timestamptz NOT NULL | `now()` |
| `finished_at` | timestamptz | nullable |
| `log_tail` / `error` | text | nullable |
| `result_meta` | jsonb | nullable |

---

### `poi_clusters` — Affectations cluster par POI (version active)

| Colonne | Type | Notes |
|---------|------|-------|
| `id` | integer NOT NULL | PK (séquence) |
| `poi_id` | uuid NOT NULL | FK → `poi_france.id`, UNIQUE(poi_id, duration_minutes, mode) |
| `cluster_id` | integer NOT NULL | |
| `cluster_label` | text | nullable |
| `pca_components` / `profile_features` / `cluster_avg_profile` | jsonb | nullable |
| `n_carreaux_intersected` | integer | nullable |
| `population_totale_couverte` | numeric | nullable |
| `model_version` | integer NOT NULL | `1` |
| `duration_minutes` | integer NOT NULL | `60` |
| `mode` | text NOT NULL | `'drive'` |
| `created_at` / `updated_at` | timestamptz | `now()` |
| `imputed_features` | jsonb | `'[]'` — features imputées |

**Index :** `poi_id`, `cluster_id`, `duration_minutes+mode`, `model_version`

---

### `poi_cluster_history` — Historique des changements de cluster

| Colonne | Type | Notes |
|---------|------|-------|
| `id` | integer NOT NULL | PK (séquence) |
| `poi_id` | uuid NOT NULL | |
| `cluster_id` / `previous_cluster_id` | integer | |
| `cluster_label` | text | nullable |
| `model_version` | integer NOT NULL | |
| `profile_features` / `pca_components` | jsonb | nullable |
| `distance_to_centroid` | numeric | nullable |
| `action` | text NOT NULL | `'assign' / 'reassign'` |
| `changed` | boolean | `false` |
| `created_at` | timestamptz | `now()` |
| `duration_minutes` | integer NOT NULL | `60` |
| `mode` | text NOT NULL | `'drive'` |

---

### `poi_categories` — Référentiel catégories POI

| Colonne | Type | Notes |
|---------|------|-------|
| `id` | uuid NOT NULL | PK |
| `categorie` | text NOT NULL | UNIQUE |
| `sous_categorie` | text | nullable |
| `label_fr` | text NOT NULL | |
| `icone` | text | `'📍'` |
| `couleur_carte` | text | `'#FF6B35'` |
| `source_defaut` | text | nullable |
| `actif` | boolean | `true` |
| `description` | text | nullable |
| `created_at` | timestamptz | `now()` |

---

### `poi_metadata_index` — Index des clés metadata POI

| Colonne | Type | Notes |
|---------|------|-------|
| `id` | uuid NOT NULL | PK |
| `poi_id` | uuid NOT NULL | FK → `poi_france.id` |
| `cle` | text NOT NULL | Clé JSON |
| `valeur` | text NOT NULL | Valeur stringifiée |

**Index :** `poi_id`, `cle`, `valeur`

---

### `france_borders` — Frontières France métropolitaine (ACTIF)

| Colonne | Type | Notes |
|---------|------|-------|
| `id` | integer NOT NULL | PK |
| `nom` | text NOT NULL | `'france_metropolitaine'` |
| `geom` | geometry NOT NULL | MultiPolygon WGS84 |

> ✓ **Utiliser cette table** pour clip Voronoï et isochrones.

**Index :** `geom` (GIST)

---

### `france_boundary` — Ancienne frontière (BUG — NE PAS UTILISER)

> ⚠️ Contient un trou de ~18 km autour de Lille. Remplacée par `france_borders`.

---

### `filosofi_national_averages` — Moyennes nationales Filosofi

| Colonne | Type | Notes |
|---------|------|-------|
| `id` | integer NOT NULL | PK |
| `feature_name` | text NOT NULL | UNIQUE — ex: `ind`, `men_pauv` |
| `avg_value` / `std_value` / `min_value` / `max_value` | numeric | nullable |
| `n_carreaux` | integer | nullable |
| `computed_at` | timestamptz | NOT NULL, `now()` |

---

## Vues

### `data_sources_view`

Joint `data_sources` + `organizations` + compteurs `poi_france` et `panneaux_affichage`. Exclut les sources `status = 'deleted'`.

```sql
SELECT ds.*, o.name AS organization_name, o.slug AS organization_slug,
  (SELECT count(*) FROM poi_france WHERE poi_france.data_source_id = ds.id) AS poi_count,
  (SELECT count(*) FROM panneaux_affichage WHERE panneaux_affichage.data_source_id = ds.id) AS panneaux_count
FROM data_sources ds LEFT JOIN organizations o ON ds.organization_id = o.id
WHERE ds.status <> 'deleted';
```

---

## RPC / Fonctions métier

> Fonctions PostGIS internes (`st_*`, `geometry_*`, etc.) exclues. Security definer = s'exécute avec les droits du propriétaire.

### Couverture Filosofi

| Fonction | Arguments | Retourne | Notes |
|----------|-----------|----------|-------|
| `calculate_coverage_per_group` | `p_groups jsonb, p_column text='ind'` | `TABLE(group_id text, coverage bigint)` | **ACTIF** — couverture par groupe (CIRFAs). `p_groups = [{id, geometries:[GeoJSON]}]` |
| `compute_coverage_fast` | `p_categorie, p_mode, p_column='ind', p_level` | `bigint` | **ACTIF** — couverture réseau depuis `isochrones_cache` |
| `compute_coverage_per_poi_batch` | `p_cache_keys text[], p_column='ind'` | `TABLE(cache_key, audience)` | Couverture par POI en batch |
| `calculate_coverage_band_scan` | `p_union_scan_geojson, target_column, ...` | `jsonb` | Scan par bandes lat |
| `calculate_coverage_breakdown` | `p_union_scan_geojson, isochrone_features, target_column` | `jsonb` | Détail par isochrone |
| `calculate_coverage_union_only` | `isochrone_features jsonb` | `jsonb` | Union seule |
| `compute_coverage_by_level` | `p_categorie, p_mode, p_column` | `TABLE(level, audience)` | Par palier |
| `compute_coverage_per_poi` | `p_categorie, p_mode, p_level, p_column` | `TABLE(cache_key, audience)` | Par POI |
| `calculate_target_coverage` | `isochrone_geojson, target_column, ...` | `numeric` | Couverture simple |
| `calculate_network_coverage` | `p_geometry, p_column` | `numeric` | Legacy v1 |
| `calculate_network_coverage_v6/v7/v8` | `isochrone_features jsonb, target_column, ...` | `jsonb` | Versions archivées |

---

### Isochrones / Bataille

| Fonction | Arguments | Retourne | Notes |
|----------|-----------|----------|-------|
| `get_isochrone_battle` | `p_rings jsonb` | `jsonb` | **ACTIF v9** — palier-ASC, ST_Difference organique. C'est la version à utiliser. |
| `get_isochrone_battle_v10` | `p_rings jsonb` | `jsonb` | ⚠️ NE PAS UTILISER — ST_Subdivide → frontières Voronoï géométriques |
| `clip_geojson_to_france` | `p_fc jsonb` | `jsonb` | Clip FeatureCollection aux frontières France |
| `clip_rings_to_france` | `p_rings jsonb` | `jsonb` | Clip rings JSON |
| `check_iso_hits_new_carreaux` | `p_iso_geojson, p_since` | `boolean` | Vérifie si de nouveaux carreaux intersectent |

---

### Voronoï

| Fonction | Arguments | Notes |
|----------|-----------|-------|
| `get_voronoi_by_category` | `cat_name, metropolitaine=true, filtre_ville, filtre_region, filtre_departement` | Voronoï géométrique clippé France |
| `get_voronoi_routier_by_category` | `cat_name, cache_key_30/60/90/120, ...` | Voronoï routier (depuis cache isochrones) |

---

### Tuiles MVT

| Fonction | Arguments | Notes |
|----------|-----------|-------|
| `get_tile_mvt` | `p_zoom, p_x, p_y` | **ACTIF** — tuile MVT ST_AsMVT pour `/api/tiles/[z]/[x]/[y]` |
| `get_tile_mvt_optimized` | `p_zoom, p_x, p_y, p_limit=2000` | Version optimisée |
| `get_tile_mvt_with_properties` | `p_zoom, p_x, p_y, p_indicator='ind'` | Avec indicateur |
| `get_tile` | `z, x, y` | Version simple (legacy) |

---

### Carreaux

| Fonction | Arguments | Notes |
|----------|-----------|-------|
| `get_carreaux_bbox` | `p_table, bbox(4), p_limit=10000, p_resolution='200m', p_millesime='2021'` | **ACTIF** — carreaux dans viewport |
| `get_carreaux` | `p_table, bbox(4), p_millesime, p_resolution` | Version legacy |
| `get_carreaux_by_zoom` | `zoom_level, bbox(4), indicateur, max_rows` | Sélection par zoom |
| `get_carreaux_for_scoring` | `p_table, p_col, bbox(4), p_millesime` | Pour scoring OOH |
| `import_carreaux_batch` | `p_idcars[], p_resolutions[], p_millesimes[], p_geom_wkts[], p_metadatas[]` | Import batch carreaux |
| `export_carreaux_batch` | `p_limit, p_offset` | Export paginé |
| `export_carreaux_after` | `p_last_idcar, p_limit` | Export keyset pagination |
| `populate_carreaux_columns` | `p_batch_size=100000` | Peuplement colonnes directes |
| `populate_geom_centroid_async` | — | Calcul async des centroïdes |
| `create_carreaux_table` / `drop_carreaux_table` | `table_name` | DDL dynamique |

---

### Filosofi profiles & stats

| Fonction | Arguments | Notes |
|----------|-----------|-------|
| `get_filosofi_profile_for_isochrone` | `p_iso_geojson, p_secret_stat=11` | Profil démographique pour une zone |
| `get_filosofi_secret_stat_diagnostic` | `p_secret_stat=11` | Diagnostic seuil secret stat |
| `compute_filosofi_national_averages` | — | Calcul moyennes nationales |
| `compute_filosofi_profiles_batch` | `p_entries jsonb, p_secret_stat=11` | Profils en batch |
| `refresh_filosofi_national_averages` | — | Rafraîchit `filosofi_national_averages` |

---

### POI & OOH

| Fonction | Arguments | Notes |
|----------|-----------|-------|
| `count_poi_by_categorie_source` | `p_categorie, p_source='data_gouv'` | integer — count POI par source |
| `find_synergy_billboards` | `poi_category, max_distance_m, target_demo_col, min_audience=0, buffer_radius_m=300, [ville]` | Panneaux synergiques avec POI |
| `panneaux_near_point` | `p_lat, p_lng, p_rayon_m=500, p_limit=50` | Panneaux proches d'un point |
| `get_poi_near_panneau` | `p_panneau_id, p_categorie, p_rayon_m=500` | POI proches d'un panneau |

---

### Clustering

| Fonction | Notes |
|----------|-------|
| `flag_new_poi_for_clustering()` | Trigger — marque `needs_clustering=true` sur INSERT |

---

### Sécurité & Auth

| Fonction | Notes |
|----------|-------|
| `get_user_role()` | `security definer` — rôle de l'utilisateur connecté (pour RLS) |
| `get_user_org()` | `security definer` — `organization_id` de l'utilisateur (pour RLS) |
| `custom_access_token_hook(event)` | `security definer` — injecte `role` + `org_id` dans le JWT |
| `handle_new_user()` | Trigger auth — crée le profil dans `profiles` à l'inscription |

---

### Utilitaires

| Fonction | Notes |
|----------|-------|
| `get_table_sizes()` | Taille des tables (monitoring `/admin/health`) |
| `notify_pgrst_reload()` | Force le rechargement du schéma PostgREST |
| `repair_iso_cache_geoms()` | Répare les géométries NULL dans `isochrones_cache` |

---

## Triggers

| Trigger | Table | Événement | Fonction | Effet |
|---------|-------|-----------|----------|-------|
| `trg_poi_france_auto_geom` | `poi_france` | INSERT / UPDATE | `auto_set_geom()` | Calcule `geom` depuis `lat`/`lng` |
| `trg_panneaux_auto_geom` | `panneaux_affichage` | INSERT / UPDATE | `auto_set_geom()` | Calcule `geom` depuis `lat`/`lng` |
| `trg_iso_cache_compute_geom` | `isochrones_cache` | INSERT / UPDATE | `fn_iso_cache_compute_geom()` | Calcule `geom` + `geom_simplified` depuis `geojson` |
| `trg_new_poi_clustering` | `poi_france` | INSERT | `flag_new_poi_for_clustering()` | Met `needs_clustering = true` |
| `trg_poi_clusters_updated_at` | `poi_clusters` | UPDATE | `fn_poi_clusters_updated_at()` | Met à jour `updated_at` |
| `trg_calculation_jobs_updated_at` | `calculation_jobs` | UPDATE | `fn_update_updated_at()` | Met à jour `updated_at` |
| `trg_saved_maps_updated_at` | `saved_maps` | UPDATE | `update_saved_maps_updated_at()` | Met à jour `updated_at` |
| `handle_new_user` (auth schema) | `auth.users` | INSERT | `handle_new_user()` | Crée `profiles` automatiquement |

---

## Index PostGIS & performance

### Résumé des index GIST (géospatiaux)

| Table | Colonne indexée |
|-------|----------------|
| `poi_france` | `geom` |
| `panneaux_affichage` | `geom` |
| `isochrones_cache` | `geom`, `geom_simplified` |
| `carreaux_filosofi` | `geom`, `geom_centroid`, `geom` INCLUDE resolution, `ST_SetSRID(geom,4326)` |
| `carreaux_2km` / `carreaux_5km` | `geom` |
| `france_borders` / `france_boundary` | `geom` |
| `carreaux_1km` / `carreaux_20km` | `geom` (vues matérialisées) |

### Index UNIQUE métier

| Table | Colonnes | Condition |
|-------|----------|-----------|
| `panneaux_affichage` | `(source, source_ref)` | — (NULLs distincts) |
| `poi_clusters` | `(poi_id, duration_minutes, mode)` | — |
| `carreaux_filosofi` | `(idcar, resolution, millesime)` | — |
| `isochrones_cache` | `cache_key` | — |

---

## RLS — Politiques de sécurité

### Lecture publique (sans authentification)

| Table | Politique |
|-------|-----------|
| `carreaux_filosofi` / `carreaux_2km` / `carreaux_5km` | SELECT public |
| `france_borders` / `france_boundary` | SELECT public |
| `poi_categories` | SELECT public |
| `organizations` | SELECT public |
| `calculation_jobs` | SELECT public (par id) |

### Lecture authentifiée

| Table | Politique |
|-------|-----------|
| `import_runs_ooh` | `auth.role() = 'authenticated'` |
| `isochrones_cache` / `isochrone_carreaux_coverage` | `auth.role() = 'authenticated'` |
| `panneaux_affichage` / `poi_metadata_index` | `auth.role() = 'authenticated'` |
| `saved_maps` | ALL pour `auth.role() = 'authenticated'` |

### Logique organisationnelle (RLS via `get_user_role()` / `get_user_org()`)

| Table | SELECT | INSERT / UPDATE / DELETE |
|-------|--------|--------------------------|
| `poi_france` | org propre OU `organization_id IS NULL` | — |
| `data_sources` | org propre OU `shared_with` OU super_admin | super_admin OU (admin de la même org) |
| `profiles` | propre profil OU super_admin | propre profil OU super_admin |
| `organizations` | public | super_admin uniquement |

### Service role uniquement

| Table | Notes |
|-------|-------|
| `clustering_jobs` / `filosofi_national_averages` | `auth.role() = 'service_role'` |
| `calculation_jobs` (ALL) | `auth.role() = 'service_role'` |

---

## Notes importantes

### ⚠️ Règles critiques

1. **Toujours filtrer** `panneaux_affichage` avec `.eq('actif', true)`
2. **Ne jamais utiliser** `france_boundary` — bug trou Lille. Utiliser `france_borders`
3. **Ne jamais utiliser** `get_isochrone_battle_v10` — ST_Subdivide crée des frontières Voronoï géométriques
4. **Inserts via `poi_france`** (vue) — le trigger `auto_set_geom` calcule automatiquement `geom` depuis `lat`/`lng`
5. **Secret statistique** Filosofi — `p_secret_stat=11` : carreaux avec < 11 individus sont masqués (valeur nulle)

### Organisation ID par défaut

L'UUID `00000000-0000-0000-0000-000000000001` est l'organisation par défaut (données globales sans tenant). Les nouveaux imports doivent utiliser `profile.organization_id` depuis la session.

### Colonnes Filosofi — Nommage

| Préfixe | Signification |
|---------|--------------|
| `ind_*` | Individus (population) |
| `men_*` | Ménages |
| `log_*` | Logements |
| `ind_0_3` … `ind_80p` | Tranches d'âge |
| `men_pauv` | Ménages pauvres |
| `men_prop` | Propriétaires |
| `men_fmp` | Familles mono-parentales |
| `men_mais` / `men_coll` | Maisons / Collectif |
| `men_surf` | Surface moyenne |
| `log_soc` | Logements sociaux |

### Résolutions carreaux disponibles

| Table | Résolution | Nb lignes | Usage |
|-------|-----------|-----------|-------|
| `carreaux_filosofi` | 200m | ~2,3M | zoom ≥ 14, scoring OOH |
| `carreaux_2km` | 2km | ~75k | zoom 8-13 |
| `carreaux_5km` | 5km | ~17k | zoom ≤ 7 |
