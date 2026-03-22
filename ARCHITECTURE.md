# ARCHITECTURE — GENESIS App

> Dernière mise à jour : 2026-03-20
> Version : 7.x
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
| Fonds de carte | OpenFreeMap (Liberty / Positron / Bright) | — |
| Isochrones | OpenRouteService (ORS) REST API | — |
| Jobs asynchrones | Inngest (serverless queue) | ^3.52 |
| Rate limiting | Upstash Redis | ^1.34 |
| PDF export | @react-pdf/renderer | ^4.3 |
| Graphiques | Recharts | ^3.8 |
| Styles | Tailwind CSS (utilitaires) + inline styles (design system terminal) | ^3.4 |
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
│   │   ├── ooh-import/         # Import panneaux OOH depuis ArcGIS REST
│   │   ├── organizations/      # CRUD organisations (clients)
│   │   └── sources/            # Gestion des sources de données importées
│   ├── clusters/               # Pages analyse clustering POI × Filosofi
│   │   └── [version]/          # Détail d'un modèle de clustering
│   ├── copilote/               # Interface principale : chat IA + carte MapLibre
│   │   ├── _components/        # Composants React du copilote (ChatPanel, MapPanel…)
│   │   ├── _hooks/             # Hooks custom (useMapInit, useToolProcessor…)
│   │   └── _lib/               # Utilitaires internes (ooh-export, constants)
│   ├── dashboard/              # Page d'accueil après login
│   ├── login/                  # Page de connexion Supabase Auth
│   ├── map/                    # Page carte complète avec FilterPanel
│   │   └── _components/        # FilterPanel, ClusterPanel, ClusteringWizard
│   └── layout.tsx              # Layout racine (GenesisNav, fonts)
│
├── components/                 # Composants React partagés (hors copilote)
│   ├── CoverageResultsPanel    # Panel résultats couverture Filosofi
│   ├── ClusterRadar            # Graphique radar profil cluster
│   ├── ClusteringPDFReport     # Export PDF rapport clustering
│   ├── CarreauxPMTilesLayer    # Couche PMTiles carreaux INSEE (constantes)
│   └── PopulationTileLayer     # Couche tuiles population vectorielle
│
├── lib/                        # Logique métier et services partagés
│   ├── auth.ts                 # createAdminClient() — client Supabase service role
│   ├── auth-client.ts          # Helpers auth côté client
│   ├── admin-fetch.ts          # Wrapper fetch avec token admin pour routes /api/admin
│   ├── supabase.ts             # createClient() — client Supabase public (anon key)
│   ├── version.ts              # Numéro de version de l'application
│   ├── chat/                   # Tout ce qui concerne le copilote IA
│   │   ├── providers.ts        # Instanciation modèles Gemini / Mistral
│   │   ├── system-prompt.ts    # Prompt système dynamique (injecte catégories POI)
│   │   ├── trim-history.ts     # Compression historique chat (garde N derniers msgs)
│   │   └── tools/              # Outils function calling (1 fichier = 1 outil IA)
│   ├── clustering/             # Logique clustering POI × Filosofi
│   │   └── feature-themes.ts   # Thèmes et libellés des features Filosofi
│   ├── db/                     # Migrations SQL applicatives (via Inngest)
│   ├── geo/                    # Utilitaires géographiques
│   │   ├── france-admin.ts     # Listes régions/départements français
│   │   └── locations.ts        # Résolution de localisation (ville/dept/region → coords)
│   ├── import/                 # Pipeline d'import universel
│   │   ├── inserter.ts         # Insert batch dans Supabase (par 50)
│   │   ├── file-parser.ts      # Parse CSV/XLSX/GeoJSON
│   │   ├── column-detector.ts  # Auto-détection colonnes lat/lng/nom
│   │   ├── geocoder.ts         # Géocodage adresse → lat/lng (BAN API)
│   │   ├── geo-enricher.ts     # Enrichissement géographique (dept/region)
│   │   ├── shp-parser.ts       # Parse Shapefile côté serveur
│   │   ├── validator.ts        # Validation des lignes avant insert
│   │   └── types.ts            # Types import (ImportRow, ParseResult…)
│   ├── inngest/                # Jobs asynchrones (couverture Filosofi)
│   │   └── functions/          # calculateCoverageJob, populateCarreauxColumns
│   ├── isochrones/
│   │   └── fetcher.ts          # Appels ORS (OpenRouteService) — batches, retry, AbortController
│   ├── mcp/
│   │   └── datagouv.ts         # Intégration MCP data.gouv.fr (opt-in sur mots-clés)
│   └── poi/
│       └── categories.ts       # Récupère les catégories POI distinctes depuis Supabase
│
├── types/                      # Interfaces TypeScript partagées
│   ├── poi.ts                  # POI, PoiRow (avec rank, audience, score_ooh)
│   ├── spatial.ts              # ZoneData, IsochroneData, VoronoiData, BattleData…
│   ├── api.ts                  # ApiError, PaginatedResponse
│   └── admin.ts                # Types administration (Organization, DataSource…)
│
├── sql/                        # Migrations SQL (à exécuter via Supabase Dashboard)
│   └── SETUP.md                # Ordre d'exécution pour une fresh DB
├── supabase/
│   └── migrations/             # Migrations gérées par Supabase CLI
├── scripts/                    # Scripts de migration et d'import ponctuels (non dans package.json)
│   ├── clustering_poi_filosofi.py     # Clustering K-means POI × Filosofi — appelé par /api/poi-clusters/run
│   ├── requirements_clustering.txt    # Dépendances Python pour clustering_poi_filosofi.py
│   ├── populate_geom_3857.ts          # Peuple carreaux_filosofi.geom_3857 (2.3M lignes) — migration one-shot, npx tsx
│   ├── import_gtfs_stops.py           # Import arrêts GTFS (bus/tram) dans poi — script one-shot
│   ├── import_iris_insee.py           # Import contours IRIS depuis fichier INSEE .zip — script one-shot
│   └── import_iris_local.py           # Import contours IRIS depuis fichier local déjà extrait — script one-shot
├── data/                       # Fichiers source de données volumineux (hors git, .gitignore)
│   └── iris/                   # CSVs INSEE Filosofi IRIS 2021-2022 (92 Mo) — utilisés par import_iris_*.py
├── tests/
│   ├── unit/                   # Tests unitaires Vitest (trim-history, etc.)
│   └── integration/            # Tests d'intégration Supabase RPC
├── docs/                       # Documentation complémentaire
└── public/                     # Assets statiques (fonts MapLibre, icônes)
```

---

## Flux de données

### Sources de données

| Source | Description | Accès |
|--------|-------------|-------|
| **Supabase** | Base principale (PostgreSQL + PostGIS). Tables POI, carreaux Filosofi, isochrones cache, OOH panneaux | `SUPABASE_*` env vars |
| **OpenRouteService** | Calcul d'isochrones (zones accessibles à pied/vélo/voiture en N minutes) | `ORS_API_KEY` |
| **INSEE Filosofi** | Données socio-démographiques par carreau 200m (population, revenus, âge…) | Import manuel SHP/Parquet |
| **ArcGIS REST** | Import panneaux OOH (affichage) depuis services ArcGIS publics | URL configurée dans l'UI |
| **data.gouv.fr MCP** | Jeux de données publics (opt-in, activé si l'utilisateur mentionne des mots-clés) | Pas de clé API |
| **BAN** | Géocodage d'adresses françaises (Base Adresse Nationale) | Gratuit, pas de clé |

### Flux principal : Copilote IA

```
Utilisateur (chat)
    ↓
POST /api/chat
    ↓
Vercel AI SDK streamText()
    ├─ Gemini 2.5 Flash (défaut) ou Mistral Small
    ├─ System prompt dynamique (catégories POI injectées)
    └─ Function calling → lib/chat/tools/
         ├─ analyser_zone_pois      → Supabase: requête POI par lieu + rayon
         ├─ calculer_isochrones     → lib/isochrones/fetcher.ts → ORS API
         ├─ isochrone_battle        → POST /api/isochrone-battle → ORS + Supabase RPC
         ├─ voronoi_par_categorie   → Supabase RPC: get_voronoi_by_category
         ├─ afficher_carreaux       → POST /api/carreaux → Supabase RPC: get_carreaux
         ├─ analyser_panneaux       → Supabase: requête global_ooh
         ├─ scorer_panneaux_ooh     → Supabase RPC: get_carreaux_for_scoring
         └─ ...
    ↓
useToolProcessor (hook React) parse les tool results
    ↓
MapPanel (MapLibre GL) affiche les couches géo
```

### Flux import universel

```
Page /admin/import
    ↓ upload fichier (CSV/XLSX/GeoJSON)
POST /api/admin/import-poi/parse    → lib/import/file-parser.ts → détection colonnes
POST /api/admin/import-poi/dry-run  → lib/import/validator.ts → preview 10 lignes
POST /api/admin/import-poi/execute  → lib/import/inserter.ts → INSERT batch×50 dans poi
```

### Flux couverture Filosofi

```
FilterPanel → POST /api/coverage-stats (streaming NDJSON)
    ↓
Pour chaque groupe de POI :
    Supabase REST direct (bypass PgBouncer) → RPC compute_coverage_fast
    → ST_Union isochrones × ST_Intersection carreaux Filosofi
    ↓ résultats streamés
CoverageResultsPanel (affichage temps réel)
```

---

## Fonctions RPC PostGIS

> Toutes définies dans `sql/` ou `supabase/migrations/`. Ne pas renommer sans mettre à jour les appels.

| Fonction RPC | Description | Appelée depuis |
|---|---|---|
| `get_voronoi_by_category` | Polygones de Voronoï par catégorie POI, clippés sur France métro | `lib/chat/tools/voronoi.ts` |
| `get_isochrone_battle` | Isochrones multi-paliers par groupe de POI avec ST_Difference organique | `app/api/isochrone-battle-v2/route.ts` |
| `clip_geojson_to_france` | Découpe un GeoJSON FeatureCollection sur `france_borders` | `app/api/isochrone-battle/route.ts`, `lib/isochrones/fetcher.ts` |
| `compute_coverage_fast` | Calcule la couverture Filosofi (pop. dans isochrones) par groupe de POI | `lib/inngest/functions/calculateCoverageJob.ts` |
| `get_carreaux` | Retourne les carreaux INSEE dans une bounding box avec indicateur Filosofi | `app/api/carreaux/route.ts` |
| `get_carreaux_by_zoom` | Comme `get_carreaux` mais adapté au zoom (simplifié à bas zoom) | `app/api/carreaux/dynamic/route.ts` |
| `get_carreaux_for_scoring` | Carreaux dans un rayon autour d'un point, pour scoring OOH | `lib/chat/tools/classerAudience.ts`, `scorerOoh.ts`, `exporterRapport.ts` |
| `calculate_target_coverage` | Calcule la couverture d'un buffer circulaire sur carreaux Filosofi | `lib/chat/tools/audienceCoverage.ts` |
| `find_synergy_billboards` | Trouve les panneaux OOH avec forte synergie (proximité × audience × demo) | `lib/chat/tools/synergy.ts` |
| `import_carreaux_batch` | Insert en batch des carreaux (upsert par source + coord) | `app/api/admin/import-filosofi/execute/route.ts`, `app/api/admin/import-geo/route.ts` |
| `populate_carreaux_columns` | Post-import : calcule les colonnes dérivées Filosofi (ratios, indices) | `lib/inngest/functions/populateCarreauxColumns.ts` |
| `drop_carreaux_table` | Supprime une table de carreaux custom par nom | `app/api/admin/sources/[id]/route.ts` |
| `get_tile` | Retourne une tuile MVT (Mapbox Vector Tile) de carreaux au format binaire | `app/api/tiles/[z]/[x]/[y]/route.ts` |
| `get_table_sizes` | Retourne la taille de toutes les tables (monitoring) | `app/api/admin/health/route.ts` |
| `count_poi_by_categorie_source` | Compte les POI par catégorie et source après import data.gouv | `app/api/admin/import-datagouv/route.ts` |

---

## Variables d'environnement

> Copier `.env.local.example` en `.env.local` et remplir les valeurs.

### Obligatoires

| Variable | Description | Où l'obtenir |
|----------|-------------|--------------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL publique du projet Supabase | Dashboard Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clé publique (anon) Supabase | Dashboard Supabase → Settings → API |
| `SUPABASE_ANON_KEY` | Idem — copie côté serveur (routes API sans `NEXT_PUBLIC_`) | Idem |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé service role (bypass RLS) — **ne jamais exposer au client** | Dashboard Supabase → Settings → API |
| `SUPABASE_DB_URL` | URL PostgreSQL directe (pour `postgres` driver) | Dashboard Supabase → Settings → Database → Connection string |
| `ORS_API_KEY` | Clé OpenRouteService pour les isochrones | openrouteservice.org → Dashboard → Tokens |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Clé Gemini (provider IA par défaut) | aistudio.google.com → Get API Key |

### Optionnelles

| Variable | Description | Défaut |
|----------|-------------|--------|
| `MISTRAL_API_KEY` | Clé Mistral AI (provider alternatif) | Provider gemini utilisé si absent |
| `UPSTASH_REDIS_REST_URL` | URL Redis Upstash pour rate limiting multi-instance | Fallback in-memory (dev uniquement) |
| `UPSTASH_REDIS_REST_TOKEN` | Token Redis Upstash | Idem |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Clé Google Maps (Maps Embed API uniquement — pas Gemini) | Fonctionnalité désactivée si absent |
| `PYTHON_PATH` | Chemin Python local (Windows uniquement) | Non utilisé par Next.js |

---

## Commandes

```bash
# Développement
npm run dev              # Lance Next.js en mode dev (http://localhost:3000)

# Build & production
npm run build            # Build Next.js (TypeScript + bundle)
npm run start            # Démarre le serveur de production
npx tsc --noEmit         # Vérification des types seulement (sans build)

# Tests
npm test                 # Lance tous les tests Vitest (unit + integration)
npm run test:watch       # Mode watch (développement)
npm run test:db          # Tests SQL Supabase (supabase test db)

# Linting
npm run lint             # ESLint sur tout le projet

# Supabase
npx supabase start       # Démarre Supabase local (Docker requis)
npx supabase db push     # Applique les migrations locales sur remote
npx supabase gen types typescript --project-id <id> > types/database.types.ts
                         # Régénère les types TypeScript depuis le schéma DB

# Migrations SQL manuelles
# ⚠️ Pour les fichiers sql/ : les appliquer via Supabase Dashboard > SQL Editor
# Voir sql/SETUP.md pour l'ordre d'exécution sur une fresh DB

# Clustering Python (offline)
cd scripts/
pip install -r requirements_clustering.txt
python clustering_poi_filosofi.py   # Calcul clustering K-means + Filosofi
```

---

## Routes API principales

### Chat & Copilote IA
| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/chat` | POST | Point d'entrée unique du copilote — streaming LLM + function calling |
| `/api/providers/status` | GET | Vérifie la disponibilité des providers IA (Gemini, Mistral) |

### Données cartographiques
| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/map/pois` | GET | POI dans une zone (ville/dept/region/rayon) avec filtres catégorie |
| `/api/map/categories` | GET | Liste des catégories POI distinctes |
| `/api/carreaux` | GET/POST | Sources et données carreaux Filosofi dans une bounding box |
| `/api/carreaux/dynamic` | GET | Tuiles carreaux adaptées au niveau de zoom |
| `/api/tiles/[z]/[x]/[y]` | GET | Tuiles MVT binaires pour rendu vectoriel |

### Isochrones & Bataille
| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/isochrone-battle` | POST | Calcul isochrones multi-POI via ORS + Supabase cache (streaming) |
| `/api/isochrone-battle-v2` | POST | Version v2 : utilise le cache uniquement (ST_Difference PostGIS) |
| `/api/isochrone-battle/apply-battle` | POST | Découpe les territoires sans chevauchement (streaming) |
| `/api/isochrone-cache-check` | GET | Vérifie quels POI ont leur cache isochrone prêt |

### Couverture Filosofi
| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/coverage-stats` | POST | Calcul couverture démographique par groupe POI (streaming NDJSON) |
| `/api/coverage-breakdown` | POST | Détail couverture par tranche d'âge |
| `/api/coverage-jobs` | POST | Lance un job Inngest de calcul en arrière-plan |

### Clustering POI
| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/poi-clusters` | GET | Liste des clusters POI par modèle |
| `/api/poi-clusters/run` | POST | Lance un calcul de clustering |
| `/api/poi-clusters/models` | GET | Historique des modèles de clustering |
| `/api/poi-clusters/models/[version]` | GET | Détail d'un modèle (clusters + profils Filosofi) |
| `/api/poi-clusters/poi/[poiId]` | GET | Cluster d'un POI donné |

### Administration
| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/admin/import-poi/parse` | POST | Parse et auto-détecte les colonnes d'un fichier CSV/XLSX/GeoJSON |
| `/api/admin/import-poi/dry-run` | POST | Preview import (10 lignes, détection erreurs) |
| `/api/admin/import-poi/execute` | POST | Exécute l'import batch dans la table `poi` |
| `/api/admin/import-ooh/arcgis` | POST | Import panneaux OOH depuis ArcGIS REST → `global_ooh` |
| `/api/admin/import-datagouv` | POST | Import POI depuis data.gouv.fr GeoJSON (streaming) |
| `/api/admin/geocode/batch` | POST | Géocode un batch d'adresses via BAN |
| `/api/admin/health` | GET | Monitoring : état tables, taille DB, fonctions RPC |
| `/api/admin/organizations` | GET/POST | CRUD organisations |
| `/api/admin/sources` | GET/POST | CRUD sources de données |
| `/api/admin/sources/[id]/export` | GET | Export CSV d'une source |

### Export & Sauvegarde
| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/export/ooh-report` | POST | Génère un rapport OOH Excel (XLSX) |
| `/api/saved-maps` | GET/POST | Sauvegarde/charge l'état carte (POI + isochrones + voronoï) |
| `/api/saved-maps/[id]` | GET/DELETE | Accès/suppression d'une carte sauvegardée |

---

## Tables principales Supabase

| Table | Description |
|-------|-------------|
| `poi` | Points d'Intérêt (source unique de vérité) — avec trigger `auto_set_geom` (lat/lng → geom PostGIS) |
| `global_ooh` | Panneaux d'affichage OOH/DOOH (toutes régies) — champ `source_ref` = OBJECTID ArcGIS |
| `carreaux_filosofi` | Carreaux INSEE 200m avec indicateurs socio-démographiques Filosofi |
| `isochrone_cache` | Cache des isochrones ORS (évite de re-calculer) — clé : `poi_id + mode + minutes` |
| `saved_maps` | États de carte sauvegardés (JSON : POI, isochrones, voronoï, carreaux) |
| `organizations` | Clients/organisations propriétaires des sources de données |
| `data_sources` | Sources de données importées (nom, type, date, org) |
| `clustering_jobs` | Jobs de clustering (statut, paramètres, version) |
| `poi_clusters` | Résultats clustering : POI → cluster_id + profil Filosofi |

---

*Voir `sql/SETUP.md` pour l'ordre d'application des migrations sur une fresh DB.*
