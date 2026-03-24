
# GEO.Prompt — AI Media Planning Platform

> **Version** : 7.4.0 — 24 mars 2026
> **Anciennement** : GENESIS — rebaptisé GEO.Prompt en v4.1.0
> **Repo** : [vincedosi/geo_promptV2-](https://github.com/vincedosi/geo_promptV2-)

Plateforme SaaS B2B de géomarketing pour planneurs média outdoor (OOH).
L'utilisateur tape un prompt en français → l'IA extrait des filtres structurés → recherche géospatiale dans Supabase → affichage carte interactive.
Import CSV/Parquet/Shapefile, sécurité renforcée, Data Lake OOH unifié, serveur de tuiles vectorielles (MVT) pour carreaux INSEE et zones IRIS, crawler INSEE intégré.

> **Nouveau dev ?** Commence par lire **[ARCHITECTURE.md](./ARCHITECTURE.md)** — arborescence, flux de données, RPC PostGIS, routes API, variables d'env.

---


## Stack technique

| Couche | Technologie |
|--------|-------------|
| **Framework** | Next.js 14 (App Router, TypeScript strict, Tailwind CSS) |
| **Base de données** | Supabase (PostgreSQL + PostGIS) |
| **Cartographie** | MapLibre GL JS 5 + OpenFreeMap tiles (Liberty/Bright/Positron) |
| **IA / NLP** | Multi-provider via Vercel AI SDK v6 : Gemini 2.5 Flash (défaut), Mistral Small (function calling, sélecteur dynamique) |
| **Parsing fichiers** | PapaParse (CSV), SheetJS (XLSX), hyparquet (Parquet), shpjs (Shapefile), fzstd (compression), natif (GeoJSON) |
| **Géocodage** | API BAN data.gouv.fr (adresses FR, gratuit) + proj4 (Lambert 93/EPSG:3035 ↔ WGS84) |
| **Isochrones** | OpenRouteService API (ORS) — temps de trajet réel voiture/vélo/marche, batch 5 POIs/appel |
| **Tuiles vectorielles** | ST_AsMVT PostGIS + route `/api/tiles/[z]/[x]/[y]` + PMTiles client |
| **Validation** | Zod (schémas JSON) |
| **Jobs asynchrones** | Inngest (background job orchestration) |
| **UI** | Design system GEO.Prompt — terminal dark (Orbitron + Michroma + JetBrains Mono + Inter) |
| **Sécurité** | RLS Supabase, requireAdmin(), adminFetch(), .env, policies SQL |

---


## Architecture & Structure complète

```
genesis_app/
│
├── app/                                   ← Next.js App Router
│   ├── page.tsx                           ← Redirect → /copilote
│   ├── layout.tsx                         ← Layout global + GenesisNav sidebar
│   │
│   ├── copilote/                          ← Page principale : Copilote Media IA
│   │   ├── layout.tsx                     ← Guard session (redirect /login en prod)
│   │   ├── page.tsx                       ← Orchestration (~160 lignes, 6 hooks)
│   │   ├── _hooks/
│   │   │   ├── useMapInit.ts              ← Init MapLibre GL + markers + patchLabelFr()
│   │   │   ├── useMapLayers.ts            ← Isochrones, Voronoï, Bataille, Carreaux layers
│   │   │   ├── useChatControls.ts         ← useChat + DefaultChatTransport + sessionTokens
│   │   │   ├── useRateLimitHandler.ts     ← Countdown auto-retry 429 (12 req/min/IP)
│   │   │   ├── useToolProcessor.ts        ← Traitement résultats outils IA → carte
│   │   │   ├── useProviderSelector.ts     ← Sélection provider IA + polling statut quota
│   │   │   └── useSavedMaps.ts            ← Sauvegarde / chargement analyses spatiales
│   │   ├── _components/
│   │   │   ├── ChatPanel.tsx              ← Panel chat (messages, input, save/load, provider, tokens)
│   │   │   ├── MapPanel.tsx               ← Panel carte (badges, toggles, légende, Street View drawer)
│   │   │   ├── PromptsPanel.tsx           ← Panel aide (6 catégories, 20 exemples de prompts)
│   │   │   ├── ZoneCard.tsx               ← Carte résumé zone analysée
│   │   │   ├── ChatMarkdown.tsx           ← Renderer Markdown inline
│   │   │   ├── DataGouvCard.tsx           ← Résultats MCP data.gouv.fr
│   │   │   └── TypingDots.tsx             ← Indicateur chargement IA
│   │   └── _lib/
│   │       └── constants.ts               ← circleGeoJSON, getCatColor
│   │
│   ├── map/                               ← Carte POI standalone
│   │   ├── layout.tsx                     ← Guard session (redirect /login en prod)
│   │   ├── page.tsx                       ← Carte interactive (POI, carreaux, Voronoï, Bataille)
│   │   └── _components/
│   │       └── FilterPanel.tsx            ← Filtres (catégorie, rayon, couverture cumulée)
│   │
│   ├── admin/                             ← Back-office (protected)
│   │   ├── ooh-import/page.tsx            ← Import OOH ArcGIS REST → global_ooh (streaming NDJSON)
│   │   ├── import/page.tsx                ← Import Universel (CSV/XLSX/GeoJSON, wizard 5 étapes)
│   │   ├── imports/page.tsx               ← Historique et gestion des imports
│   │   ├── carreaux-import/page.tsx       ← Import Carreaux INSEE (upload web, CSV only)
│   │   ├── filosofi-import/page.tsx       ← Import batch Filosofi (CSV/Parquet)
│   │   ├── sources/page.tsx               ← Gestion des sources de données (CRUD)
│   │   ├── organizations/page.tsx         ← Gestion multi-tenant
│   │   ├── profiles/page.tsx              ← Gestion des profils utilisateurs
│   │   └── health/page.tsx                ← Health Check système + diagnostics
│   │
│   ├── login/page.tsx
│   ├── dashboard/page.tsx
│   ├── sign-up/page.tsx
│   ├── init/page.tsx
│   └── api/                               ← Routes API (40+ endpoints)
│       │
│       ├── chat/route.ts                  ← Copilote IA (streamText, multi-provider, tools, MCP, trimHistory)
│       ├── providers/status/route.ts      ← Statut providers IA (quota, clé, cache 5min)
│       │
│       ├── search-poi/
│       │   ├── route.ts                   ← Recherche POI par catégorie (paginé 1000/batch)
│       │   └── categories/route.ts        ← Liste des catégories POI distinctes
│       ├── map/
│       │   ├── categories/route.ts        ← Catégories POI pour /map
│       │   └── pois/route.ts              ← POI par bbox/catégorie
│       │
│       ├── carreaux/
│       │   ├── route.ts                   ← GET: sources / POST: GeoJSON bbox
│       │   └── dynamic/route.ts           ← Requêtes carreaux dynamiques (multi-résolution)
│       │
│       ├── tiles/[z]/[x]/[y]/route.ts     ← Serveur MVT carreaux (ST_AsMVT PostGIS, zoom ≥10)
│       ├── iris-tiles/[z]/[x]/[y]/route.ts ← Serveur MVT zones IRIS (ST_AsMVT, geom IRIS)
│       │
│       ├── iris/
│       │   ├── geojson/route.ts           ← IRIS GeoJSON bbox + colonne (whitelist sécurisée)
│       │   └── stats/route.ts             ← Stats IRIS par colonne et niveau (iris/dept)
│       │
│       ├── iris-crawler/                  ← Crawler INSEE IRIS (5 routes)
│       │   ├── discover/route.ts          ← Découverte URLs sur page INSEE
│       │   ├── download/route.ts          ← Téléchargement CSV streaming
│       │   ├── preview/route.ts           ← Aperçu colonnes + stats
│       │   ├── status/route.ts            ← Statut téléchargements en cours
│       │   └── upload/route.ts            ← Upload fichier vers Supabase Storage
│       │
│       ├── isochrone-battle/
│       │   ├── route.ts                   ← Bataille Isochrones (ORS batch, cache, PostGIS v9)
│       │   └── apply-battle/route.ts      ← Appliquer résultat pré-calculé
│       │
│       ├── coverage-stats/route.ts        ← Statistiques couverture audience
│       ├── coverage-jobs/route.ts         ← Suivi jobs couverture
│       ├── coverage-breakdown/route.ts    ← Détail couverture par tranche
│       │
│       ├── saved-maps/
│       │   ├── route.ts                   ← GET/POST analyses sauvegardées
│       │   └── [id]/route.ts              ← GET/PUT/DELETE analyse spécifique
│       │
│       ├── export/ooh-report/route.ts     ← Export Excel rapport OOH
│       ├── inngest/route.ts               ← Webhook Inngest (jobs asynchrones)
│       │
│       └── admin/                         ← Routes admin (toutes protégées par requireAdmin())
│           ├── iris/stats/route.ts        ← Stats admin IRIS (toutes colonnes)
│           ├── import-poi/
│           │   ├── parse/route.ts
│           │   ├── execute/route.ts       ← SSE import POI (streaming temps réel)
│           │   └── dry-run/route.ts
│           ├── import-ooh/arcgis/route.ts ← ArcGIS REST → global_ooh (NDJSON streaming)
│           ├── import-filosofi/
│           │   ├── parse/route.ts
│           │   └── execute/route.ts       ← CSV Filosofi batch
│           ├── filosofi-import/route.ts   ← Endpoint dédié Filosofi (CSV/Parquet)
│           ├── import-geo/
│           │   ├── route.ts               ← Shapefile → carreaux_filosofi (unnest batch)
│           │   └── register/route.ts      ← Enregistrement source dans data_sources
│           ├── import-datagouv/route.ts   ← data.gouv.fr import GeoJSON
│           ├── geocode/batch/route.ts     ← Géocodage batch BAN
│           ├── sources/route.ts           ← CRUD sources de données
│           ├── organizations/route.ts     ← CRUD organisations
│           └── health/route.ts            ← Health check système
│
├── components/                            ← Composants globaux partagés
│   ├── GenesisNav.tsx                     ← Sidebar navigation (Orbitron + Michroma)
│   ├── CoverageResultsPanel.tsx           ← Panel résultats couverture (multi-métriques)
│   ├── CarreauxPMTilesLayer.tsx           ← Couche carreaux via PMTiles
│   └── PopulationTileLayer.tsx            ← Couche population MVT (tiles API)
│
├── lib/                                   ← Librairies et utilitaires
│   ├── version.ts                         ← APP_VERSION = '7.4.0' (TOUJOURS INCRÉMENTER)
│   ├── auth.ts                            ← createAdminClient(), requireAdmin(), adminFetch()
│   ├── admin-fetch.ts                     ← Helper adminFetch() côté client
│   ├── auth-client.ts                     ← Client auth côté navigateur
│   ├── supabase.ts                        ← Client Supabase public
│   │
│   ├── chat/
│   │   ├── providers.ts                   ← createModel(), getMaxRetries() (maxRetries=0 Gemini)
│   │   ├── system-prompt.ts               ← Prompt système dynamique (catégories, zone, outils)
│   │   └── tools/                         ← Outils IA modulaires (1 fichier = 1 outil)
│   │       ├── index.ts                   ← buildTools() — assemble tous les outils
│   │       ├── schemas.ts                 ← Zod schemas compressés (~60% vs verbeux)
│   │       ├── types.ts                   ← Types partagés (ToolContext, etc.)
│   │       ├── _shared.ts                 ← Helpers internes (createAdminClient, etc.)
│   │       ├── analyserZone.ts            ← analyser_zone_pois
│   │       ├── voronoi.ts                 ← voronoi_analysis
│   │       ├── isochrones.ts              ← isochrone_battle
│   │       ├── carreaux.ts                ← afficher_carreaux
│   │       ├── panneaux.ts                ← analyser_panneaux
│   │       ├── audienceCoverage.ts        ← calculate_audience_coverage
│   │       ├── synergy.ts                 ← analyze_poi_synergy
│   │       ├── classerAudience.ts         ← classer_panneaux_audience
│   │       ├── scorerOoh.ts               ← scorer_panneaux_ooh
│   │       └── exporterRapport.ts         ← exporter_rapport_ooh
│   │
│   ├── iris-crawler/                      ← Crawler INSEE IRIS — téléchargement & parsing
│   │   ├── types.ts                       ← IrisCatalogEntry, CatalogStatus, DownloadedBase…
│   │   ├── catalog.ts                     ← Catalogue jeux de données IRIS (RP, Filosofi, BPE…)
│   │   ├── parser.ts                      ← Parsing CSV IRIS (headers, stats colonnes)
│   │   ├── storage.ts                     ← Persistance Supabase Storage (status, download)
│   │   ├── db-columns.ts                  ← Mapping colonnes CSV → colonnes DB `iris`
│   │   └── auto-map.ts                    ← Auto-mapping colonnes CSV → schema IRIS
│   │
│   ├── mcp/
│   │   └── datagouv.ts                    ← Client MCP data.gouv.fr (JSON-RPC, sanitizeSchema Gemini)
│   │
│   ├── geo/
│   │   ├── france-admin.ts                ← Données statiques géo FR (départements, régions, CIRFAs)
│   │   └── locations.ts                   ← Résolution de lieux
│   │
│   ├── isochrones/
│   │   └── fetcher.ts                     ← ORS API — batch 5 POIs/appel, AbortController 12s, retry
│   │
│   ├── import/
│   │   ├── file-parser.ts                 ← CSV/XLSX/Parquet/Shapefile/GeoJSON parser
│   │   ├── geocoder.ts                    ← Géocodage BAN (adresses FR)
│   │   ├── inserter.ts                    ← Insert batch Supabase (poi_france, batch 50)
│   │   └── ...                            ← Pipeline universel
│   │
│   ├── poi/
│   │   └── categories.ts                  ← Catégories POI distinctes (cache 60s)
│   │
│   ├── inngest/
│   │   ├── client.ts                      ← Client Inngest
│   │   └── functions/                     ← Fonctions background
│   │
│   ├── db/                                ← Helpers base de données
│   └── api/                               ← Helpers API
│
├── supabase/
│   └── migrations/                        ← Migrations Supabase (ordre chronologique)
│       ├── 006_carreaux_mvt_tile_server.sql   ← get_tile_mvt() — MVT ultra-simple
│       ├── 007_carreaux_mvt_optimized.sql     ← MVT optimisé (propriétés, tri)
│       ├── 008_carreaux_multiresolution.sql   ← Vues matérialisées 1km / 5km + RPC sélection
│       └── 034_populate_carreaux_preaggregate.sql ← Peuplement carreaux_2km + carreaux_5km
│
├── sql/                                   ← Scripts SQL actifs (exécuter dans Supabase Dashboard)
│   ├── SETUP.md                           ← Guide setup complet — ordre d'exécution pour fresh DB
│   ├── 001_unify_poi_table.sql            ← Table poi (renommage + index)
│   ├── 002_import_datagouv.sql            ← Index source + RPC count_pois_by_source()
│   ├── 003_carreaux_filosofi.sql          ← Table carreaux_filosofi (2.3M lignes)
│   ├── 003_carreaux_rpc.sql               ← RPC get_carreaux() bbox queries
│   ├── 004_get_table_sizes_function.sql   ← RPC get_table_sizes() monitoring
│   ├── 004_scoring_rpc.sql                ← RPC get_carreaux_for_scoring() outils IA
│   ├── 005_global_ooh.sql                 ← Tables global_ooh + import_runs_ooh
│   ├── 005_upsert_carreaux_batch.sql      ← RPC notify_pgrst_reload()
│   ├── 006_find_synergy_billboards.sql    ← RPC find_synergy_billboards()
│   ├── 007_view_carreaux_filosofi.sql     ← Vue carreaux_filosofi (compatibilité)
│   ├── 010_security_hardening.sql         ← RLS + policies — TOUJOURS EXÉCUTER EN DERNIER
│   ├── 013_calculation_jobs.sql           ← Table calculation_jobs + ENUM job_status
│   ├── 016_add_geom_centroid_indexed.sql  ← Colonne geom_centroid indexée (long ~10min)
│   ├── 017_rpc_compute_coverage_fast.sql  ← compute_coverage_fast() v1 (base)
│   ├── 018_calculation_jobs_breakdown.sql ← Colonne breakdown JSONB
│   ├── 025_rpc_compute_coverage_per_poi_batch_v2.sql ← compute_coverage_per_poi_batch()
│   ├── 026_carreaux_filosofi_colonnes_directes.sql   ← Colonnes directes sur carreaux
│   ├── 029_revert_coverage_fast_jsonb.sql ← Revert coverage fast → JSONB
│   ├── 035_fix_compute_coverage_fast_intersects.sql  ← Fix ST_Intersects (ACTIF)
│   ├── 042_get_isochrone_battle_v9_outer_fill.sql    ← get_isochrone_battle() v9 (ACTIF)
│   ├── 043_plpgsql_loop_no_temptable.sql  ← calculate_coverage_per_group() v4 (ACTIF)
│   └── archive/                           ← Versions intermédiaires supersédées (ne pas réappliquer)
│
├── tests/
│   ├── unit/
│   │   ├── trim-history.test.ts           ← stripHeavyFields + trimHistory (14 tests)
│   │   └── isochrones-fetcher.test.ts     ← buildIsochCacheKey + ORS constants + batching (20 tests)
│   └── integration/
│       └── supabase-rpc.test.ts           ← calculate_coverage_per_group, clip_france, carreaux (11 tests)
├── vitest.config.ts                       ← Config tests (node env, alias @/)
│
├── middleware.ts                           ← Middleware Next.js (passthrough)
├── next.config.js                         ← Large body (10GB), maplibre-gl webpack fix
├── .mcp.json                              ← Config MCP servers (Supabase)
├── .env.local                             ← Clés API (jamais commité)
└── .env.example                           ← Template variables d'environnement
```

---


## Base de données Supabase

### Tables principales

| Table | Description |
|-------|-------------|
| **poi** | Points d'intérêt (vue `poi_france` maintenue pour compatibilité) |
| **global_ooh** | Data Lake panneaux OOH — toutes régies, toutes sources (`source_ref` = OBJECTID ArcGIS, filtre `statut = 'actif'`) |
| **import_runs_ooh** | Historique des imports OOH (source, nb_inserts, nb_updates, durée) |
| **isochrones_cache** | Cache des isochrones ORS + couverture Filosofi pré-calculée |
| **carreaux_filosofi** | 2 310 582 carreaux 200m France métropolitaine (1,6 GB) |
| **carreaux_2km** | ~75k cellules agrégées 2km (zoom 8-13) — colonnes directes, < 100ms |
| **carreaux_5km** | ~17k cellules agrégées 5km (zoom 7) — colonnes directes, < 100ms |
| **data_sources** | Sources de données importées |
| **organizations** | Organisations multi-tenant |
| **profiles** | Profils utilisateurs (`role`: super_admin / admin / client) |
| **saved_maps** | Analyses géospatiales sauvegardées |
| **france_borders** | MultiPolygon France métropolitaine (clip Voronoï + isochrones) |
| **calculation_jobs** | Suivi des jobs de calcul couverture |
| **iris** | Zones IRIS INSEE — code_iris, nom_iris, code_commune, code_dept, geom (MultiPolygon 4326), colonnes démographiques (population, CSP, tranches d'âge) |

### Fonctions & RPC PostGIS

| Fonction | Description |
|----------|-------------|
| `get_carreaux_bbox(table, bbox, limit)` | Carreaux dans un viewport (bbox) |
| `get_isochrone_battle(p_rings JSONB)` | Bataille d'Isochrones v9 — palier-ASC, raw rings (version active) |
| `get_voronoi_by_category(cat, ...)` | Voronoï géométrique par catégorie POI, clippé France |
| `compute_coverage_fast(...)` | Couverture audience rapide (colonnes directes, ST_UnaryUnion) |
| `get_tile_mvt(z, x, y)` | Tuiles vectorielles MVT carreaux (ST_AsMVT, zoom ≥10) |
| `get_iris_tile_mvt(z, x, y)` | Tuiles vectorielles MVT zones IRIS (ST_AsMVT) |
| `calculate_coverage_per_group(...)` | Couverture par groupe (CIRFAs, dédupliquée) |

---


## Fonctionnalités principales

### Copilote Media IA (`/copilote`)

Chat conversationnel IA + carte interactive split screen.

**Multi-provider** (Vercel AI SDK v6) :
- **Gemini** `gemini-2.5-flash` — provider par défaut, thinking désactivé (`budget=0`), `maxRetries=0`
- **Mistral** `mistral-small-latest`

**10 Outils IA** (modules séparés dans `lib/chat/tools/`, schémas Zod compressés ~60%) :

| Outil | Module | Description |
|-------|--------|-------------|
| `analyser_zone_pois` | `analyserZone.ts` | POI par zone + isochrones ORS |
| `voronoi_analysis` | `voronoi.ts` | Voronoï géométrique par catégorie |
| `isochrone_battle` | `isochrones.ts` | Bataille d'Isochrones (ORS, cache, PostGIS v9) |
| `afficher_carreaux` | `carreaux.ts` | Choroplèthe carreaux INSEE |
| `analyser_panneaux` | `panneaux.ts` | Panneaux OOH depuis `global_ooh` |
| `calculate_audience_coverage` | `audienceCoverage.ts` | Couverture audience autour d'un point |
| `analyze_poi_synergy` | `synergy.ts` | Synergie panneaux × démographie POI |
| `classer_panneaux_audience` | `classerAudience.ts` | Ranking panneaux par audience |
| `scorer_panneaux_ooh` | `scorerOoh.ts` | Scoring OOH (global_ooh) |
| `exporter_rapport_ooh` | `exporterRapport.ts` | Export Excel rapport OOH |

**Optimisations tokens** :
- `trimHistory()` : max 14 messages + strip `pois[]`, `isochroneGeoJSON`, `voronoiGeoJSON.features`, etc.
- Schémas outils compressés (~60% réduit vs descriptions verboses)
- Compteur tokens session visible dans le header (input/output)

**MCP data.gouv.fr** (opt-in, déclenché par mots-clés) :
- 6 outils : `search_datasets`, `get_dataset_info`, etc.
- `sanitizeSchema()` pour compatibilité Gemini
- Résultats affichés en `DataGouvCard`

**Rate limit** : 12 req/min/IP — Upstash Redis (multi-instance Vercel) avec fallback in-memory, countdown affiché avec auto-retry.

**Street View** : drawer latéral au clic sur un panneau OOH.


### Bataille d'Isochrones (v9 palier-ASC)

Algorithme actif (`sql/042_get_isochrone_battle_v9_outer_fill.sql`) :
- **Raw rings seulement** — pas de phase Voronoï (supprimée en v7.0.0)
- Anneaux palier-ASC : chaque zone = ring propre (ST_Difference)
- Clip aux frontières France (`france_borders`)
- Cache ORS : 1 requête pour tous les modes si déjà en cache (vs 7 auparavant)
- ORS batch : 5 POIs/appel → 40 POIs = 8 requêtes (5× speedup premier calcul)
- Fix ST_UnaryUnion : CIRFAs dédupliquées, plus de double-comptage


### Serveur de Tuiles Vectorielles (MVT)

Route `/api/tiles/[z]/[x]/[y]` :
- Génère des tuiles MapBox Vector Tiles via ST_AsMVT PostGIS
- Zoom minimum z=10 (204 No Content en dessous)
- Limite adaptive : 500 (z≤10) / 1000 (z≤12) / 1500 (z>12)
- Headers Cache-Control adaptés au zoom

Tables pré-agrégées pour performances < 100ms :
- `carreaux_5km` — zoom 7 (~17k cellules, peuplée par migration 034)
- `carreaux_2km` — zoom 8-13 (~75k cellules, peuplée par migration 034)
- Vues matérialisées 1km/5km (migration 008)

Composants client :
- `CarreauxPMTilesLayer.tsx` — couche PMTiles
- `PopulationTileLayer.tsx` — couche MVT population


### Zones IRIS (`/api/iris/`, `/api/iris-tiles/`)

Table `iris` : zones géographiques INSEE (2 000+ communes, ~50k zones) avec données démographiques.

- **Tuiles MVT** : `/api/iris-tiles/[z]/[x]/[y]` — rendu MapLibre vectoriel direct via ST_AsMVT
- **GeoJSON bbox** : `/api/iris/geojson?bbox=...&colonne=pop_15_29` — whitelist colonnes sécurisée (8 colonnes autorisées)
- **Stats** : `/api/iris/stats?colonne=...&level=iris|dept` — agrégation par niveau
- Colonnes disponibles : `population`, `pop_0_14`, `pop_15_29`, `pop_30_44`, `pop_45_59`, `pop_60_74`, `pop_75_plus`, `nb_csp_cadre`, `nb_csp_employe`, `nb_csp_ouvrier`
- Index GIST sur `geom` pour performances spatiales


### Crawler INSEE IRIS (`/api/iris-crawler/`)

Pipeline de téléchargement et ingestion des données tabulaires INSEE (RP, Filosofi, BPE, Referentiel) :

1. **Discover** → scrape la page INSEE pour trouver les URLs CSV/ZIP disponibles
2. **Download** → télécharge en streaming, parse headers + stats colonnes, stocke dans Supabase Storage
3. **Preview** → aperçu des premières lignes + profil des colonnes (type, null%, min/max, samples)
4. **Upload** → intègre le fichier dans la table `iris` (auto-mapping colonnes CSV → schema DB)
5. **Status** → suivi des téléchargements actifs

Catalogue géré dans `lib/iris-crawler/catalog.ts` — 5 catégories : `rp`, `filosofi`, `carreaux`, `bpe`, `referentiel`.


### Couverture Audience Multi-Cibles

- Analyse simultanée de plusieurs points (CIRFAs, zones)
- Couverture cumulée via `ST_UnaryUnion` PostGIS (pas de double-comptage)
- Couverture Filosofi mise en cache dans `isochrones_cache` (évite recalcul 200m)
- UI : `CoverageResultsPanel` (multi-select métriques, bouton "Lancer les calculs")
- FilterPanel `/map` : section Couverture Cumulée dédiée


### Data Lake OOH (`global_ooh`)

Table centralisée pour tous les panneaux OOH toutes régies :
- Import ArcGIS REST → `global_ooh` via `/api/admin/import-ooh/arcgis` (streaming NDJSON)
- UI admin : `/admin/ooh-import` (streaming temps réel, nommage post-import, historique)
- Filtre `.eq('statut', 'actif')` sur tous les outils IA
- `source_ref` = OBJECTID ArcGIS (upsert idempotent)
- 1 363 panneaux Brest importés et validés


### Carte Interactive POI (`/map`)

- Markers par catégorie (sans clustering — supprimé en v7.0.0)
- Couche carreaux INSEE choroplèthe, sélecteur métrique dynamique
- Voronoï géométrique — zones d'influence par catégorie POI
- Bataille d'Isochrones — sectorisation par temps de trajet réel ORS
- Export Excel des POIs affichés
- Section Couverture Cumulée dans FilterPanel


### Import Universel & Import batch Filosofi

**Import Universel** (`/admin/import`) : pipeline 5 étapes (Upload → Mapping auto → Géolocalisation → Dry Run → Import SSE temps réel)

**Import Filosofi** (`/admin/filosofi-import`) :
- Import CSV/Parquet (PapaParse, hyparquet, fzstd)
- Endpoint dédié `/api/admin/filosofi-import` (batch, streaming)
- Vue dynamique `carreaux_filosofi` (compatibilité outils IA)

---


## Securite & Bonnes pratiques

- **Toutes les routes** `app/api/admin/*` sont protégées par `requireAdmin()` en première ligne
- **Pages admin** : utilisent `adminFetch()` (jamais `fetch()` nu)
- **Pages utilisateur** (`/copilote`, `/map`) : protégées par layout guard session (redirect `/login` en prod, accès libre en dev)
- **RLS activé** sur toutes les tables publiques (voir `010_security_hardening.sql`)
- **Policies SQL** : accès lecture/écriture finement contrôlé (service_role, authenticated)
- **Aucune clé API** ne doit être committée
- **ON CONFLICT DO NOTHING** sur tous les inserts
- **global_ooh** : toujours filtrer `.eq('statut', 'actif')`
- **.env.local** obligatoire pour les opérations admin
- **`geojsonUrl`** : validée par `new URL()` + whitelist HTTPS (`data.gouv.fr`, `arcgis.com`, `opendatasoft.com`...) — anti-SSRF
- **`organization_id`** : toujours issu de `profile.organization_id` (session admin), jamais hardcodé
- **Cache `?refresh=1`** : protégé par `requireAdmin()` sur `/api/map/categories`

---


## Variables d'environnement (.env.local)

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...    # OBLIGATOIRE pour les opérations admin

# IA — provider par défaut : Gemini
GOOGLE_GENERATIVE_AI_API_KEY=...    # Gemini 2.5-flash (billing requis)
MISTRAL_API_KEY=sk_...              # Mistral small (optionnel)

# Isochrones ORS
ORS_API_KEY=...

# Admin
ADMIN_INIT_KEY=...
SUPABASE_DB_URL=postgresql://...    # Requis pour import-geo uniquement
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Jobs asynchrones
INNGEST_EVENT_KEY=...               # Optionnel
INNGEST_SIGNING_KEY=...             # Optionnel
```

---


## Regles de développement

### 1. Versioning (obligatoire)

**Fichier central** : `lib/version.ts`

```typescript
export const APP_VERSION = '7.4.0'; // TOUJOURS INCRÉMENTER
```

| Type | Version |
|------|---------|
| Refonte majeure / breaking | MAJOR |
| Nouvelle feature | MINOR |
| Bugfix / logs / petits ajustements | PATCH |

Le changelog détaillé est dans le fichier `ARCHITECTURE.md`.

### 2. Securite routes admin

- Toute nouvelle route dans `app/api/admin/` **doit** commencer par `requireAdmin()`
- Toute page admin **doit** utiliser `adminFetch()` (jamais `fetch()` nu)

### 3. Vercel AI SDK v6 — Patterns

```typescript
// Backend
const result = streamText({
  model: createModel(provider),
  messages: await convertToModelMessages(trimmedMessages),
  stopWhen: stepCountIs(3),
  tools: buildTools(categoriesList, forceRecalculate),
});
return result.toUIMessageStreamResponse({
  messageMetadata: ({ part }) => { /* inject tok_in/tok_out */ }
});

// Frontend
const { messages, sendMessage, status } = useChat({
  transport: new DefaultChatTransport({ api: '/api/chat' })
});
```

### 4. Providers IA

| Provider | Modele | Remarques |
|----------|--------|-----------|
| `gemini` | `gemini-2.5-flash` | Défaut, thinking=0, maxRetries=0 (quota strict) |
| `mistral` | `mistral-small-latest` | |

### 5. Regles generales

1. **Ne jamais committer les clés API**
2. **ON CONFLICT DO NOTHING** sur tous les inserts
3. **Toute route admin** → `requireAdmin()` en première ligne
4. **Tout appel admin côté client** → `adminFetch()` (jamais `fetch()` nu)
5. **global_ooh** : toujours filtrer `.eq('statut', 'actif')`
6. **Scripts SQL** : toujours exécuter `010_security_hardening.sql` après migration
7. **Versioning** : incrémenter `APP_VERSION` dans `lib/version.ts` à chaque commit de code

---


## Demarrage & Déploiement

```powershell
cd C:\GENESIS\genesis_app
npm install
npx next dev
# http://localhost:3000  (redirige vers /copilote)
# Health check: http://localhost:3000/admin/health
```

### Pages disponibles

| URL | Description |
|-----|-------------|
| `/` | Redirect `/copilote` |
| `/copilote` | Copilote Media IA (chat + carte split screen) — page principale |
| `/map` | Carte POI + carreaux + Voronoï + Bataille d'Isochrones |
| `/login` | Connexion / Inscription |
| `/dashboard` | Tableau de bord |
| `/admin/ooh-import` | Import OOH ArcGIS REST → global_ooh |
| `/admin/import` | Import Universel (CSV/XLSX/GeoJSON) |
| `/admin/imports` | Historique et gestion des imports |
| `/admin/carreaux-import` | Import Carreaux INSEE (CSV only) |
| `/admin/filosofi-import` | Import batch Filosofi (CSV/Parquet) |
| `/admin/sources` | Gestion des sources de données |
| `/admin/organizations` | Gestion des organisations |
| `/admin/profiles` | Gestion des profils utilisateurs |
| `/admin/health` | Health Check système |

---


## Changelog

| Version | Date | Changements cles |
|---------|------|------------------|
| **7.4.0** | 2026-03-24 | Zones IRIS : table `iris` + serveur MVT `/api/iris-tiles/[z]/[x]/[y]` + API GeoJSON/stats whitelist colonnes. Crawler INSEE IRIS : pipeline 5 routes (discover/download/preview/upload/status), `lib/iris-crawler/` (catalog, parser, storage, db-columns, auto-map). Layouts session guard `/copilote` et `/map` (redirect prod). Pages admin : `/admin/imports` (historique imports), `/admin/profiles` (gestion profils). Fix bataille v2 auto-trigger après calcul ORS des manquants. |
| **7.3.0** | 2026-03-20 | Grand nettoyage codebase. TypeScript strict : `catch (e: unknown)` uniformisé (30 fichiers), 0 erreur `tsc --noEmit`. Sécurité : `init-admin GET` protégé, SSRF bloqué sur `geojsonUrl` (whitelist), cache `/map/categories` protégé, org UUID hardcodé → `profile.organization_id`. Perf : N+1 `/admin/organizations` → 3 requêtes fixes. Dead code : 2 fichiers orphelins supprimés, packages `@ai-sdk/anthropic` + `fflate` retirés. Provider Claude retiré (Gemini + Mistral uniquement). |
| **7.2.0** | 2026-03-18 | Rate limit Upstash Redis (prod multi-instance Vercel). `trimHistory` 8→14 messages. sql/ consolidé (18 scripts archivés, SETUP.md). Middleware passthrough supprimé. 45 tests Vitest (unit + intégration Supabase RPC). 10 erreurs TypeScript corrigées. |
| **7.1.0** | 2026-03-17 | ORS batch 5 POIs/appel (5× speedup), cache couverture Filosofi dans `isochrones_cache`, stats couverture améliorées, filtrage /map. |
| **7.0.1** | 2026-03-16 | Fix: CIRFAs invisibles après battle — `poisForMap` reconstruit depuis ring features si absent. |
| **7.0.0** | 2026-03-16 | Grand nettoyage (~2892 lignes / 20 fichiers supprimés). Coverage dédupliquée ST_UnaryUnion. `CoverageResultsPanel` multi-select. Clip isochrones France (`sql/031`). Bataille v9 palier-ASC (phase 5 Voronoï supprimée). Serveur MVT `/api/tiles/[z]/[x]/[y]`. Tables pré-agrégées `carreaux_2km` / `carreaux_5km`. `lib/chat/tools/` éclaté en modules. `lib/changelog.ts` séparé. `lib/geo/france-admin.ts`. Suppression hooks map (`useClusters`, `useMapPanels`, `useMapViewport`) + composants abandonnés. |
| **6.9.0** | 2026-03-09 | Design system refonte, token counter copilote, trimHistory optimisé, redirect `/copilote`. |
| **6.8.2** | 2026-03-09 | Import OOH ArcGIS streaming NDJSON. UI `/admin/ooh-import`. Outils IA branchés sur `global_ooh`. |
| **6.8.1** | 2026-03-08 | Street View drawer. Fix timeout ORS adaptatif. Fix Gemini quota countdown. |
| **6.8.0** | 2026-03-08 | Data Lake OOH (`global_ooh`). Multi-provider copilote. MCP data.gouv.fr Gemini-compat. `ChatMarkdown`, `DataGouvCard`. |
| **6.6.0** | 2026-03-06 | Refonte import Shapefile : wizard 3 étapes, parser SHP/DBF/PRJ client-side, reprojection proj4. API `/api/carreaux` refaite. |
| **6.5.1** | 2026-03-03 | Fix "voronoï routier" + Panel Prompts `?` (6 catégories, 20 exemples). |
| **6.5.0** | 2026-03-03 | Rate limit 12 req/min/IP, AbortController ORS 12s. |
| **6.4.0** | 2026-03-03 | UI decomp — 6 hooks + 5 composants + page.tsx 160 lignes. |
| **6.3.0** | 2026-03-03 | Migration Vercel AI SDK v6 : streamText, useChat, DefaultChatTransport. |
| **6.0.0** | 2026-03-02 | Sécurité : requireAdmin() 18 routes, adminFetch(), createAdminClient() strict. |
| **5.9.0** | 2026-02-28 | Isochrones ORS dans Copilote (walk/drive/bike). |
| **5.7.0** | 2026-02-26 | Voronoï géométrique PostGIS + Carreaux choroplèthe INSEE. |
| **4.1.0** | 2026-02-24 | Renommage GEO.Prompt (ex-GENESIS), Health Check, versioning dynamique. |
| **1.0.0** | 2026-02-10 | Lancement initial, Parse Prompt IA, Supabase + PostGIS. |

---


## Roadmap — Types de cartes OOH/DOOH

### Effectué

| # | Carte | Implementation |
|---|-------|----------------|
| 1 | **Isochrone / Isodistance** | ORS API, walk/bike/drive, caching, bataille v9, clip France |
| 2 | **Choroplèthe (Carroyage)** | Carreaux INSEE Filosofi 200m/2km/5km, MVT tile server, PMTiles |
| 3 | **Voronoï (Thiessen)** | Géométrique (`voronoi_analysis`) + Routier (`isochrone_battle` anneaux palier-ASC) |
| 5 | **Valeurs Uniques (Catégories)** | `getCatColor()`, markers colorés par catégorie |
| 10 | **Heatmap** | Layer `pois-heatmap` MapLibre (source `pois-heat`), density visualization >300 POIs, fade zoom 11-13 |

### MVP Vital — Restant

| # | Carte | Cas d'usage OOH |
|---|-------|-----------------|
| 4 | **Clustering (Regroupement)** | Inventaire national 10k+ panneaux sans crash navigateur |

### Différenciation

| # | Carte | Cas d'usage OOH |
|---|-------|-----------------|
| 6 | **Masquage (Polygones Inversés)** | Effet "Projecteur" : zone sélectionnée lumineuse, reste assombri |
| 7 | **Réseau Linéaire (Trafic)** | Visualiser TMJA, grands axes pour 4x3 routiers |
| 8 | **Symboles Proportionnels** | Taille du marker = volume d'impressions DOOH |
| 9 | **Bassin de Visibilité (Viewshed)** | Prouver qu'un panneau est visible depuis un carrefour |

### Premium

| # | Carte | Cas d'usage OOH |
|---|-------|-----------------|
| 11 | **Hexagones (H3 / Hexbin)** | Alternative moderne au carroyage INSEE |
| 12 | **Carte Animée (Spatio-Temporelle)** | Dayparting DOOH : audience matin vs soir |
| 13 | **Extrusion 3D (Prismes 2.5D)** | Effet "Wahou" : population en 3D autour des gares |

### Bonus Expert

| # | Carte |
|---|-------|
| 14 | Choroplèthe Bivariée — zones très peuplées ET forts revenus |
| 15 | Flux (Lignes de désir) — data transport GTFS |
| 16 | Diagrammes sur carte — répartition sociodémo par zone |

---


## Problemes connus & solutions

| Probleme | Solution |
|----------|----------|
| `EPERM lstat LA_vsidol01` | Lancer PowerShell en tant que LA_vsidol01 |
| Port 3000 occupé | Next.js passe auto sur 3001 |
| `.env.local` pas chargé | Redémarrer le serveur Next.js |
| Bataille timeout (>280s) | Lancer d'abord depuis `/map` pour remplir le cache ORS |
| Routes admin 403 | Vérifier `SUPABASE_SERVICE_ROLE_KEY` dans `.env.local` |
| Gemini rate limit 429 | Billing non activé — switcher sur Mistral |
| MCP data.gouv.fr timeout | Serveur parfois lent — timeout 5s, skippé silencieusement |
| MVT tuiles vides | Vérifier zoom ≥10 et que `carreaux_2km`/`carreaux_5km` sont peuplées (migration 034) |

---

*GEO.Prompt v7.4.0 — AI Media Planning Platform*
