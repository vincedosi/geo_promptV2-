# ARCHITECTURE — GEOMATIK

> Dernière mise à jour : 2026-04-08
> Version : 7.6.x
> Auteur initial : Vince Dosi

---

## Stack technique

| Couche | Technologie | Version |
|--------|-------------|---------|
| Framework web | Next.js (App Router) | ^14.2 |
| Runtime UI | React | ^19.0 |
| Langage | TypeScript | ^5.3 |
| Base de données | Supabase (PostgreSQL 15 + PostGIS) | ^2.97 |
| Cartographie | MapLibre GL JS | ^5.18 |
| LLM / Copilote | Vercel AI SDK + Gemini 2.5 Flash / Mistral Small | ai ^6.0 |
| Fonds de carte | OpenFreeMap (Liberty / Positron / Bright) + Geomatik dark style |
| Isochrones | OpenRouteService (ORS) REST API | — |
| Jobs asynchrones | Inngest (serverless queue) | ^3.52 |
| Rate limiting | Upstash Redis | ^1.34 |
| PDF export | @react-pdf/renderer | ^4.3 |
| Graphiques | Recharts | ^3.8 |
| Styles | Tailwind CSS + Design System GEOMATIK (dark minimal) | ^3.4 |
| Fonts | Inter (UI) + JetBrains Mono (données/code) | — |
| Validation | Zod | ^3.22 |
| Tests | Vitest | ^2.0 |
| CI/CD | Vercel (déploiement automatique sur push `main`) | — |

---

## Arborescence

```
genesis_app/
├── app/                        # Next.js App Router — pages et routes API
│   ├── api/                    # Routes API (voir section dédiée)
│   ├── admin/                  # Pages d'administration back-office
│   │   ├── carreaux-import/    # Import des carreaux Filosofi (SHP/Parquet)
│   │   ├── filosofi-import/    # Import direct INSEE Filosofi (SHP/DBF/Parquet)
│   │   ├── health/             # Monitoring : état DB, tables, fonctions RPC
│   │   ├── import/             # Import universel de POI (CSV/XLSX/GeoJSON)
│   │   ├── imports/            # Historique et gestion des imports
│   │   ├── ooh-import/         # Import panneaux OOH depuis ArcGIS REST
│   │   ├── campaigns/          # Campagnes DSP — liste, import (preview → SSE), détail
│   │   │   └── [id]/           # Détail campagne + stats + données paginées
│   │   ├── organizations/      # CRUD organisations (clients)
│   │   ├── profiles/           # Gestion des profils utilisateurs
│   │   └── sources/            # Gestion des sources de données (+ onglet DSP)
│   ├── clusters/               # Pages analyse clustering POI × Filosofi
│   │   └── [version]/          # Détail d'un modèle de clustering
│   ├── copilote/               # Interface principale : chat IA + carte MapLibre
│   │   ├── _components/        # ChatPanel, MapPanel, PromptsPanel, ZoneCard…
│   │   ├── _hooks/             # useMapInit, useMapLayers, useChatControls, useToolProcessor…
│   │   └── _lib/               # constants.ts (circleGeoJSON, getCatColor)
│   ├── dashboard/              # Page d'accueil après login
│   │   └── iris-crawler/       # Interface crawler INSEE IRIS
│   ├── login/                  # Page de connexion Supabase Auth
│   ├── map/                    # Page carte complète avec FilterPanel
│   │   └── _components/        # FilterPanel, IrisDetailPanel, ClusteringWizard
│   ├── template.tsx            # Page transitions
│   └── layout.tsx              # Layout racine (AppSidebar, fonts Inter + JetBrains Mono)
│
├── components/                 # Composants React partagés
│   ├── AppSidebar.tsx          # Sidebar navigation GEOMATIK
│   ├── CoverageResultsPanel    # Panel résultats couverture Filosofi
│   ├── ClusterRadar            # Graphique radar profil cluster
│   ├── ClusteringPDFReport     # Export PDF rapport clustering
│   ├── CarreauxPMTilesLayer    # Couche PMTiles carreaux INSEE
│   ├── PopulationTileLayer     # Couche tuiles population vectorielle
│   └── ui/                     # Composants UI GEOMATIK
│       ├── GeoBot.tsx          # Mascotte/assistant visuel
│       ├── GeoConfetti.tsx     # Animation confetti géo
│       ├── GeoSkeleton.tsx     # Skeleton loading
│       ├── PageTransition.tsx  # Transition entre pages
│       ├── SplashScreen.tsx    # Écran de chargement initial
│       ├── confirm-modal.tsx   # Modal de confirmation
│       ├── geo-toast.tsx       # Notifications toast
│       ├── help-tooltip.tsx    # Tooltips d'aide
│       ├── search-filter.tsx   # Barre de recherche/filtre
│       └── section-header.tsx  # En-tête de section (dot teal + bandeau)
│
├── lib/                        # Logique métier et services partagés
│   ├── auth.ts                 # createAdminClient(), requireAdmin()
│   ├── auth-client.ts          # Helpers auth côté client
│   ├── admin-fetch.ts          # adminFetch() — wrapper fetch avec token admin
│   ├── supabase.ts             # createClient() — client Supabase public (anon key)
│   ├── version.ts              # APP_VERSION (toujours incrémenter)
│   ├── chat/                   # Copilote IA
│   │   ├── providers.ts        # createModel() — Gemini / Mistral
│   │   ├── system-prompt.ts    # Prompt système dynamique
│   │   ├── trim-history.ts     # Compression historique chat (14 msgs max)
│   │   └── tools/              # Outils function calling (1 fichier = 1 outil)
│   ├── clustering/             # Clustering POI × Filosofi
│   ├── db/                     # Migrations SQL applicatives
│   ├── geo/                    # france-admin.ts, locations.ts
│   ├── campaigns/              # DSP campaign import
│   │   ├── column-mappings.ts  # Mapping colonnes DSP → DB (Adform, DV360…)
│   │   └── parser.ts           # Parser CSV/XLSX + mapping + validation
│   ├── import/                 # Pipeline d'import universel
│   ├── inngest/                # Jobs async (couverture, colonnes dérivées)
│   ├── iris-crawler/           # Crawler INSEE IRIS (catalog, parser, storage, auto-map)
│   ├── isochrones/             # fetcher.ts — ORS batch 5 POIs/appel
│   ├── map/                    # geomatik-style.ts — style carte dark GEOMATIK
│   ├── mcp/                    # datagouv.ts — MCP data.gouv.fr
│   └── poi/                    # categories.ts — catégories distinctes (cache 60s)
│
├── types/                      # Interfaces TypeScript partagées
│   ├── poi.ts                  # POI, PoiRow (rank, audience, score_ooh)
│   ├── campaign.ts             # DspCampaign, DspCampaignData, CampaignImportEvent…
│   ├── spatial.ts              # ZoneData, IsochroneData, VoronoiData, BattleData…
│   ├── api.ts                  # ApiError, PaginatedResponse
│   └── admin.ts                # Organization, DataSource…
│
├── sql/                        # Migrations SQL (Supabase Dashboard)
│   ├── SETUP.md                # Ordre d'exécution pour fresh DB
│   └── archive/                # Versions supersédées
├── supabase/migrations/        # Migrations Supabase CLI
├── scripts/                    # Scripts ponctuels
├── data/                       # Données volumineuses (hors git)
├── tests/                      # unit/ + integration/
├── docs/                       # Documentation
└── public/                     # Assets statiques (fonts, icônes, logos GEOMATIK)
```

---

## Routes API

### Chat & Copilote IA
| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/chat` | POST | Copilote — streaming LLM + function calling |
| `/api/providers/status` | GET | Disponibilité providers IA |

### Données cartographiques
| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/map/pois` | GET | POI dans une zone avec filtres catégorie |
| `/api/map/categories` | GET | Catégories POI distinctes (`?refresh=1` protégé admin) |
| `/api/search-poi` | GET | Recherche POI par catégorie (paginé 1000/batch) |
| `/api/carreaux` | GET/POST | Carreaux Filosofi dans une bounding box |
| `/api/carreaux/dynamic` | GET | Tuiles carreaux adaptées au zoom |
| `/api/tiles/[z]/[x]/[y]` | GET | Tuiles MVT carreaux (gzip obligatoire) |
| `/api/iris-tiles/[z]/[x]/[y]` | GET | Tuiles MVT zones IRIS |
| `/api/iris-tiles-proxy` | GET | Proxy CORS pour PMTiles IRIS (GitHub Releases) |

### IRIS
| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/iris/geojson` | GET | IRIS GeoJSON par bbox + colonne (whitelist sécurisée) |
| `/api/iris/stats` | GET | Stats IRIS par colonne et niveau (iris/dept) |
| `/api/iris/detail` | GET | Détail socio-démo d'un IRIS |

### Crawler INSEE IRIS
| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/iris-crawler/discover` | POST | Découverte URLs sur page INSEE |
| `/api/iris-crawler/download` | POST | Téléchargement CSV streaming |
| `/api/iris-crawler/preview` | POST | Aperçu colonnes + stats |
| `/api/iris-crawler/upload` | POST | Upload fichier → table `iris` |
| `/api/iris-crawler/status` | GET | Statut téléchargements en cours |

### Isochrones & Bataille
| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/isochrone-battle` | POST | ⚠️ NE PAS MODIFIER — isochrones multi-POI streaming |
| `/api/isochrone-battle/apply-battle` | POST | Découpe territoires sans chevauchement |
| `/api/isochrone-cache-check` | GET | Vérifie cache isochrone par POI |

### Couverture Filosofi
| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/coverage-stats` | POST | Couverture démographique (streaming NDJSON) |
| `/api/coverage-breakdown` | POST | Détail par tranche d'âge |
| `/api/coverage-jobs` | POST | Lance job Inngest |

### Clustering POI
| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/poi-clusters` | GET | Clusters par modèle |
| `/api/poi-clusters/run` | POST | Lance calcul clustering |
| `/api/poi-clusters/models` | GET | Historique modèles |
| `/api/poi-clusters/models/[version]` | GET | Détail modèle + profils |
| `/api/poi-clusters/poi/[poiId]` | GET | Cluster d'un POI |

### Campagnes DSP (toutes protégées par `requireAdmin()`)
| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/admin/campaigns` | GET | Liste campagnes avec stats agrégées (via RPC) |
| `/api/admin/campaigns/preview` | POST | Preview mapping fichier AVANT import (colonnes + sample) |
| `/api/admin/campaigns/import` | POST | Import SSE streaming (parse → batch insert → matching IRIS) |
| `/api/admin/campaigns/populate-postal` | POST | Peuple `postal_code_commune` depuis La Poste |
| `/api/admin/campaigns/[id]` | GET | Détail campagne + stats par pays/région/dept + données paginées |
| `/api/admin/campaigns/[id]` | DELETE | Suppression campagne (CASCADE sur données) |
| `/api/admin/campaigns/[id]/match-iris` | POST | Relance matching IRIS pour une campagne |

### Administration (toutes protégées par `requireAdmin()`)
| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/admin/import-poi/parse` | POST | Parse + auto-détection colonnes |
| `/api/admin/import-poi/dry-run` | POST | Preview import (10 lignes) |
| `/api/admin/import-poi/execute` | POST | Import batch SSE streaming |
| `/api/admin/import-ooh/arcgis` | POST | Import OOH ArcGIS REST (NDJSON) |
| `/api/admin/import-datagouv` | POST | Import data.gouv.fr (SSRF whitelist) |
| `/api/admin/import-filosofi/*` | POST | Import Filosofi CSV/Parquet |
| `/api/admin/import-geo/*` | POST | Import Shapefile |
| `/api/admin/geocode/batch` | POST | Géocode batch BAN |
| `/api/admin/health` | GET | Monitoring DB |
| `/api/admin/organizations` | GET/POST | CRUD organisations |
| `/api/admin/sources` | GET/POST | CRUD sources |
| `/api/admin/sources/[id]/export` | GET | Export CSV source |
| `/api/admin/iris/stats` | GET | Stats admin IRIS |

### Export & Sauvegarde
| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/export/ooh-report` | POST | Rapport OOH Excel (XLSX) |
| `/api/saved-maps` | GET/POST | Sauvegarde/charge état carte |
| `/api/saved-maps/[id]` | GET/PUT/DELETE | Accès/modification/suppression |
| `/api/inngest` | POST | Webhook Inngest |

---

## Tables Supabase

| Table | Description | Notes |
|-------|-------------|-------|
| `poi` / `poi_france` (vue) | Points d'Intérêt | Trigger `auto_set_geom`, vue pour compat |
| `global_ooh` | Panneaux OOH/DOOH toutes régies | `source_ref` = OBJECTID, filtre `statut = 'actif'` |
| `import_runs_ooh` | Historique imports OOH | nb_inserts, nb_updates, durée |
| `carreaux_filosofi` | Carreaux INSEE 200m (2.3M lignes, 4.5 GB) | `geom_3857` pré-calculé |
| `carreaux_2km` | Agrégation 2km (~75k, zoom 8-13) | Colonnes directes, <100ms |
| `carreaux_5km` | Agrégation 5km (~17k, zoom 7) | Colonnes directes, <100ms |
| `iris` | Zones IRIS INSEE (~51k) | Colonnes socio-démo **dynamiques**, `is_true_iris` |
| `iris_import_history` | Historique imports IRIS | |
| `iris_indicator_registry` | Registre indicateurs IRIS | 51 indicateurs |
| `iris_metadata` | Métadonnées IRIS | |
| `isochrones_cache` | Cache isochrones ORS | Clé : poi_id + mode + minutes |
| `scoring_profiles` | Profils JSON scoring OOH paramétrique | |
| `data_registry` | Registre données pour routeur multi-agents | |
| `saved_maps` | États carte sauvegardés (user_id) | |
| `organizations` | Clients/organisations | |
| `data_sources` | Sources de données importées | |
| `profiles` | Profils utilisateurs (role: super_admin/admin/client) | |
| `clustering_jobs` | Jobs de clustering K-means | |
| `clustering_models` | Modèles de clustering | |
| `poi_clusters` | Résultats POI → cluster_id | |
| `poi_cluster_history` | Historique assignations cluster | |
| `poi_categories` | Catégories POI | |
| `poi_accessibility_config` | Paramètres σ accessibilité par catégorie | |
| `comptages_routiers` | Comptages routiers (~408k lignes) | |
| `panneaux_affichage` | Panneaux affichage (~938 lignes) | |
| `france_borders` | Contours France métro (clip isochrones/Voronoï) | |
| `france_boundary` | Boundary simplifié | |
| `calculation_jobs` | Jobs de calcul couverture | |
| `filosofi_national_averages` | Moyennes nationales Filosofi | |
| `smart_prompt_feedback` | Feedback prompts IA (user_id) | |
| `smart_ville_stats` | Stats villes | |
| `dsp_campaigns` | Campagnes DSP (Adform, DV360…) | nom, source, dates, pays, tracked_ads |
| `dsp_campaign_data` | Lignes d'impressions DSP | UNIQUE(campaign_id, date, postal_code, city), ON DELETE CASCADE |
| `postal_code_commune` | Référentiel La Poste code postal → commune | ~35k lignes, source geo.api.gouv.fr |

---

## Fonctions RPC PostGIS

| RPC | Description | Appelée depuis |
|-----|-------------|----------------|
| `get_isochrone_battle` | Isochrones multi-paliers v9, ST_Difference | `api/isochrone-battle/` |
| `compute_panneau_scores_v2` | Scoring OOH paramétrique (profils JSON) | `lib/chat/tools/scorerOoh.ts` |
| `compute_coverage_fast` | Couverture Filosofi dans isochrones | `lib/inngest/functions/` |
| `calculate_coverage_per_group` | Couverture par groupe (dédupliquée) | `api/coverage-stats/` |
| `clip_rings_to_france` | Clip anneaux isochrones sur France | Routes isochrone |
| `clip_geojson_to_france` | Clip GeoJSON sur `france_borders` | `api/isochrone-battle/` |
| `get_carreaux_bbox` | Carreaux dans un viewport | `api/carreaux/` |
| `get_carreaux` | Carreaux dans bbox avec indicateur | `api/carreaux/` |
| `get_carreaux_by_zoom` | Carreaux adaptés au zoom | `api/carreaux/dynamic/` |
| `get_carreaux_for_scoring` | Carreaux dans rayon (scoring) | `lib/chat/tools/` |
| `calculate_target_coverage` | Couverture buffer circulaire | `lib/chat/tools/audienceCoverage.ts` |
| `find_synergy_billboards` | Panneaux OOH synergie | `lib/chat/tools/synergy.ts` |
| `get_voronoi_by_category` | Voronoï par catégorie, clippé France | `lib/chat/tools/voronoi.ts` |
| `get_tile_mvt` | Tuile MVT carreaux (ST_AsMVT) | `api/tiles/` |
| `get_iris_tile_mvt` | Tuile MVT IRIS (ST_AsMVT) | `api/iris-tiles/` |
| `import_carreaux_batch` | Upsert batch carreaux | `api/admin/import-filosofi/` |
| `populate_carreaux_columns` | Colonnes dérivées post-import | `lib/inngest/functions/` |
| `get_table_sizes` | Taille tables (monitoring) | `api/admin/health/` |
| `count_poi_by_categorie_source` | Compte POI par catégorie/source | `api/admin/import-datagouv/` |
| `match_campaign_postal_to_iris` | Matching DSP postal → commune → IRIS | `api/admin/campaigns/import/` |
| `get_dsp_campaign_stats` | Stats agrégées par campagne (COUNT FILTER) | `api/admin/campaigns/` |

---

## Variables d'environnement

### Obligatoires
| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL publique Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clé publique (anon) |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé service role — **jamais exposer au client** |
| `SUPABASE_DB_URL` | URL PostgreSQL directe |
| `ORS_API_KEY` | Clé OpenRouteService |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Clé Gemini |

### Optionnelles
| Variable | Description |
|----------|-------------|
| `MISTRAL_API_KEY` | Provider alternatif |
| `UPSTASH_REDIS_REST_URL` | Redis rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | Token Redis |
| `ADMIN_INIT_KEY` | Clé init admin |
| `INNGEST_EVENT_KEY` | Jobs async |
| `INNGEST_SIGNING_KEY` | Signing jobs |
| `NEXT_PUBLIC_APP_URL` | URL app (défaut localhost:3000) |

---

## Commandes

```bash
npm run dev              # Dev (localhost:3000)
npm run build            # Build production
npx tsc --noEmit         # Type-check
npm test                 # Vitest
npm run lint             # ESLint
npx supabase db push     # Appliquer migrations
npx supabase gen types typescript --project-id <id> > types/database.types.ts
```

---

*GEOMATIK — Geospatial intelligence*
