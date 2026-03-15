
# GEO.Prompt — AI Media Planning Platform

> **Version** : 7.0.0 — 11 mars 2026
> **Anciennement** : GENESIS — rebaptisé GEO.Prompt en v4.1.0
> **Repo** : [vincedosi/geo_promptV2-](https://github.com/vincedosi/geo_promptV2-)

Plateforme SaaS B2B de géomarketing pour planneurs média outdoor (OOH).
L'utilisateur tape un prompt en français → l'IA extrait des filtres structurés → recherche géospatiale dans Supabase → affichage carte interactive.
Import CSV/Parquet/Shapefile, sécurité renforcée, et Data Lake OOH unifié.

---


## 📦 Stack technique

| Couche | Technologie |
|--------|-------------|
| **Framework** | Next.js 14 (App Router, TypeScript strict, Tailwind CSS) |
| **Base de données** | Supabase (PostgreSQL + PostGIS) |
| **Cartographie** | MapLibre GL JS + CARTO Light raster tiles (gratuit, sans token) |
| **IA / NLP** | Multi-provider via Vercel AI SDK v6 : Gemini, Mistral, Claude (function calling, sélecteur dynamique) |
| **Parsing fichiers** | PapaParse (CSV), SheetJS (XLSX), hyparquet (Parquet), shpjs (Shapefile), fzstd (compression), natif (GeoJSON) |
| **Géocodage** | API BAN data.gouv.fr (adresses FR, gratuit) + proj4 (Lambert 93 ↔ WGS84) |
| **Isochrones** | OpenRouteService API (ORS) — temps de trajet réel voiture/vélo/marche |
| **Clustering** | Supercluster (clustering côté client) |
| **Validation** | Zod (schémas JSON) |
| **UI** | Design system GEO.Prompt — terminal dark (Orbitron + Michroma + Inter) |
| **Sécurité** | RLS Supabase, adminFetch, .env, policies SQL, audit |

---


## 🏗️ Architecture & Structure

```
genesis_app/
├── app/
│   ├── page.tsx                           ← Redirect → /copilote
│   ├── layout.tsx                         ← Layout global + GenesisNav sidebar
│   ├── map/page.tsx                       ← Carte POI + carreaux + Bataille d'Isochrones
│   ├── copilote/
│   │   ├── page.tsx                       ← Orchestration (~160 lignes, 6 hooks)
│   │   ├── _hooks/
│   │   │   ├── useMapInit.ts              ← Init MapLibre + markers
│   │   │   ├── useMapLayers.ts            ← Isochrones, Voronoï, Bataille, Carreaux
│   │   │   ├── useChatControls.ts         ← useChat + DefaultChatTransport + sessionTokens
│   │   │   ├── useRateLimitHandler.ts     ← Countdown auto-retry 429
│   │   │   ├── useToolProcessor.ts        ← Traitement résultats outils IA
│   │   │   ├── useProviderSelector.ts     ← Sélection provider IA + statut quota/disponibilité
│   │   │   └── useSavedMaps.ts            ← Sauvegarde / chargement cartes
│   │   ├── _components/
│   │   │   ├── ChatPanel.tsx              ← Panel chat (messages, input, save/load, provider selector, token counter)
│   │   │   ├── MapPanel.tsx               ← Panel carte (badges, toggles, légende, Street View)
│   │   │   ├── PromptsPanel.tsx           ← Panel aide prompts (6 catégories, 20 exemples)
│   │   │   ├── ZoneCard.tsx               ← Carte résumé zone analysée
│   │   │   ├── ChatMarkdown.tsx           ← Renderer Markdown inline
│   │   │   ├── DataGouvCard.tsx           ← Cartes résultats data.gouv.fr MCP
│   │   │   └── TypingDots.tsx             ← Indicateur chargement IA
│   │   └── _lib/
│   │       └── constants.ts               ← circleGeoJSON, getCatColor
│   ├── admin/
│   │   ├── ooh-import/page.tsx            ← Import OOH ArcGIS REST → global_ooh (streaming, historique)
│   │   ├── import/page.tsx                ← Import Universel (CSV/XLSX/GeoJSON, 5 étapes)
│   │   ├── carreaux-import/page.tsx       ← Import Carreaux INSEE (upload web, CSV only)
│   │   ├── filosofi-import/page.tsx       ← 🆕 Import batch Filosofi (CSV/Parquet, endpoint dédié)
│   │   ├── sources/page.tsx               ← Gestion des sources de données
│   │   ├── organizations/page.tsx         ← Gestion multi-tenant
│   │   └── health/page.tsx                ← Health Check système
│   └── api/
│       ├── chat/route.ts                  ← Copilote IA (streamText, multi-provider, tools Zod, MCP data.gouv, trimHistory)
│       ├── providers/status/route.ts      ← Statut providers IA (quota Mistral, clé Claude/Gemini, cache 5min)
│       ├── search-poi/route.ts            ← Recherche POI par catégorie (paginé 1000/batch)
│       ├── search-poi/categories/route.ts ← Liste des catégories POI
│       ├── carreaux/route.ts              ← GET: sources / POST: GeoJSON bbox
│       ├── isochrone-battle/route.ts      ← Bataille d'Isochrones (ORS, cache, PostGIS)
│       ├── saved-maps/route.ts            ← Sauvegarde/chargement analyses
│       ├── saved-maps/[id]/route.ts       ← Détail/suppression analyse
│       ├── admin/
│           ├── filosofi-import/route.ts   ← 🆕 Import batch Filosofi (CSV/Parquet, endpoint dédié)
│           ├── import-filosofi/execute/route.ts ← 🆕 Import CSV Filosofi (PapaParse, streaming)
│           ├── import-filosofi/parse/route.ts   ← 🆕 Parse CSV Filosofi (PapaParse)
│           ├── import-ooh/arcgis/route.ts ← Import ArcGIS REST → global_ooh (NDJSON streaming)
│           ├── import-poi/execute/route.ts ← SSE import POI en base
│           ├── import-geo/route.ts        ← Import batch Shapefile → carreaux_filosofi
│           ├── sources/route.ts           ← CRUD sources
│           ├── organizations/route.ts     ← CRUD organisations
│           ├── geocode/batch/route.ts     ← Géocodage batch BAN
│           └── health/route.ts            ← Health check
├── components/
│   ├── GenesisNav.tsx                     ← Sidebar navigation (Orbitron + Michroma design)
│   └── map/
│       ├── MapContainer.tsx               ← Carte + markers + carreaux + Voronoï + Bataille
│       ├── MapSidebar.tsx                 ← Sidebar résultats
│       └── hooks/
│           ├── useClusters.ts             ← Clustering Supercluster
│           ├── useMapPanels.ts            ← Panneaux latéraux
│           └── useMapViewport.ts          ← Viewport carte
├── lib/
│   ├── chat/
│   │   ├── tools.ts                       ← Outils IA (10 tools, schémas compressés)
│   │   ├── system-prompt.ts               ← Prompt système dynamique
│   │   └── providers.ts                   ← createModel(), getMaxRetries()
│   ├── mcp/
│   │   └── datagouv.ts                    ← Client MCP data.gouv.fr (JSON-RPC, sanitizeSchema Gemini-compat)
│   ├── auth.ts                            ← Helpers auth serveur (createAdminClient strict)
│   ├── isochrones/fetcher.ts              ← ORS API (isochrones, retry, AbortController)
│   ├── import/inserter.ts                 ← Insert batch Supabase (poi_france)
│   ├── import/                           ← 🆕 Logic import CSV/Parquet/Shapefile (pipeline universel)
│   ├── poi/categories.ts                  ← Catégories POI
│   └── version.ts                         ← VERSION CENTRALE + changelog
├── sql/
│   ├── 005_global_ooh.sql                 ← Table global_ooh + import_runs_ooh
│   ├── 006_import_carreaux_batch.sql      ← 🆕 Import batch carreaux (RPC, streaming)
│   ├── 007_view_carreaux_filosofi.sql     ← 🆕 Vue carreaux_filosofi (compatibilité outils dynamiques)
│   ├── 010_security_hardening.sql         ← 🆕 Script sécurité RLS, policies, search_path
│   └── isochrone_battle_v1.sql            ← get_isochrone_battle() — ST_Difference
├── middleware.ts                           ← Middleware Next.js (passthrough)
├── .env.local                             ← Clés API (jamais commité)
└── .env.example                           ← Template variables d'environnement
```

---


## 🔒 Sécurité & Bonnes pratiques

- **Toutes les routes** `app/api/admin/*` sont protégées par `requireAdmin()`
- **Pages admin** : utilisent `adminFetch` (token Bearer injecté)
- **RLS activé** sur toutes les tables publiques (voir `010_security_hardening.sql`)
- **Policies SQL** : accès lecture/écriture finement contrôlé (service_role, authenticated)
- **Aucune clé API** ne doit être committée
- **ON CONFLICT DO NOTHING** sur tous les inserts
- **.env.local** obligatoire pour les opérations admin

---


## 🔑 Variables d'environnement (.env.local)

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...    ← OBLIGATOIRE pour les opérations admin

# IA — provider par défaut : Gemini
GOOGLE_GENERATIVE_AI_API_KEY=...    ← Gemini 2.5-flash (billing requis)
MISTRAL_API_KEY=sk_...              ← Mistral small (optionnel)
ANTHROPIC_API_KEY=sk-ant-...        ← Claude haiku (optionnel)

# Isochrones ORS
ORS_API_KEY=...

# Admin
ADMIN_INIT_KEY=...
SUPABASE_DB_URL=postgresql://...    ← Requis pour import-geo uniquement
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---


## 🗄️ Base de données Supabase

### Tables principales

| Table | Description |
|-------|-------------|
| **poi** | Points d'intérêt (vue `poi_france` maintenue pour compatibilité) |
| **global_ooh** | 🆕 Data Lake panneaux OOH — toutes régies, toutes sources (source_ref = OBJECTID ArcGIS, statut: actif/inactif) |
| **import_runs_ooh** | 🆕 Historique des imports OOH (source, nb_inserts, nb_updates, durée) |
| **isochrones_cache** | Cache des isochrones ORS |
| **data_sources** | Sources de données importées |
| **carreaux_filosofi** | 2 310 582 carreaux 200m France métropolitaine (1,6 GB, import CSV/Parquet, vue dynamique) |
| **organizations** | Organisations multi-tenant |
| **profiles** | Profils utilisateurs (role: super_admin / admin / client) |
| **saved_maps** | Analyses géospatiales sauvegardées |
| **france_borders** | MultiPolygon France métropolitaine (clip Voronoï) |


### Fonctions & RPC PostGIS

| Fonction | Description |
|----------|-------------|
| `get_carreaux_bbox(table, bbox, limit)` | Carreaux dans un viewport |
| `get_isochrone_battle(p_rings JSONB)` | Bataille d'Isochrones — ST_Difference pur |
| `get_voronoi_by_category(cat, ...)` | Voronoï géométrique par catégorie POI |

---


## 🎯 Fonctionnalités principales


### Copilote Media IA (`/copilote`)

Chat conversationnel IA + carte interactive split screen.

**Multi-provider** (Vercel AI SDK v6) :
- **Gemini** `gemini-2.5-flash` — provider par défaut, thinking désactivé (budget=0)
- **Mistral** `mistral-small-latest`
- **Claude** `claude-haiku-4-5-20251001`

**Outils IA** (10 tools, schémas compressés) :
- `analyser_zone_pois` — POI par zone + isochrones ORS
- `voronoi_analysis` — Voronoï géométrique par catégorie
- `isochrone_battle` — Bataille d'Isochrones (temps réel ORS)
- `afficher_carreaux` — choroplèthe carreaux INSEE
- `analyser_panneaux` — 🆕 panneaux OOH depuis `global_ooh` (pagination automatique 10k+)
- `calculate_audience_coverage` — couverture audience autour d'un point
- `analyze_poi_synergy` — synergie panneaux × démographie POI
- `classer_panneaux_audience` — ranking panneaux par audience
- `scorer_panneaux_ooh` — 🆕 scoring OOH depuis `global_ooh`
- `exporter_rapport_ooh` — 🆕 export rapport OOH

**Optimisations tokens** :
- `trimHistory()` : max 8 messages + strip `pois[]`, `isochroneGeoJSON`, `voronoiGeoJSON.features`, `poisForMap.pois`, `features[]` des tool results anciens
- Schémas outils compressés (~60% réduit vs descriptions verboses)
- Compteur tokens session visible dans le header (↑input ↓output tok)

**MCP data.gouv.fr** (opt-in, déclenché par mots-clés) :
- 6 outils : `search_datasets`, `get_dataset_info`, etc.
- `sanitizeSchema()` : compatibilité Gemini
- Résultats affichés en `DataGouvCard`

**Street View** : 🆕 drawer latéral au clic sur un panneau OOH

**Rate limit** : 12 req/min/IP in-memory, countdown affiché


### Data Lake OOH (`global_ooh`)

Table centralisée pour tous les panneaux OOH toutes régies :
- Import ArcGIS REST → `global_ooh` via `/api/admin/import-ooh/arcgis` (streaming NDJSON)
- UI admin : `/admin/ooh-import` (streaming temps réel, nommage post-import, historique des runs)
- Filtre `.eq('statut', 'actif')` sur tous les outils IA
- `source_ref` = OBJECTID ArcGIS (upsert idempotent)
- **1 363 panneaux Brest** importés et validés


### Carte Interactive POI (`/map`)

- Markers DOM par catégorie avec clustering Supercluster
- Couche carreaux INSEE choroplèthe, sélecteur métrique dynamique
- Voronoï géométrique — zones d'influence par catégorie POI
- Bataille d'Isochrones — sectorisation par temps de trajet réel ORS
- 🆕 Heatmap densité + GPU layers
- 🆕 Dashboard POI + pagination illimitée
- Export Excel des POIs affichés


### Import Universel & Import batch Filosofi

**Import Universel** (`/admin/import`) : pipeline 5 étapes (Upload → Mapping auto → Géolocalisation → Dry Run → Import SSE temps réel)

**Import Filosofi** (`/admin/filosofi-import`) :
- Import CSV/Parquet (PapaParse, hyparquet, fzstd)
- Endpoint dédié `/api/admin/filosofi-import/route.ts` (batch, streaming)
- Vue dynamique `carreaux_filosofi` (compatibilité outils IA)
- Scripts SQL : `006_import_carreaux_batch.sql`, `007_view_carreaux_filosofi.sql`

Pipeline 5 étapes : Upload → Mapping auto → Géolocalisation → Dry Run → Import SSE temps réel.

---


## ⚠️ Règles de développement & sécurité

### 1. Versioning (obligatoire)

**Fichier central** : `lib/version.ts`

```typescript
export const APP_VERSION = '6.9.0'; // ← TOUJOURS INCRÉMENTER
```

| Type | Version |
|------|---------|
| Refonte majeure / breaking | MAJOR |
| Nouvelle feature | MINOR |
| Bugfix / logs | PATCH |

### 2. Sécurité routes admin

- Toute nouvelle route dans `app/api/admin/` **doit** commencer par `requireAdmin()`
- Toute page admin **doit** utiliser `adminFetch()`

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

| Provider | Modèle | Remarques |
|----------|--------|-----------|
| `gemini` | `gemini-2.5-flash` | Défaut, thinking=0, maxRetries=0 (quota strict) |
| `claude` | `claude-haiku-4-5-20251001` | |
| `mistral` | `mistral-small-latest` | |

### 5. Règles générales

1. **Ne jamais committer les clés API**
2. **ON CONFLICT DO NOTHING** sur tous les inserts
3. **Toute route admin** → `requireAdmin()` en première ligne
4. **Tout appel admin côté client** → `adminFetch()` (jamais `fetch()` nu)
5. **global_ooh** : toujours filtrer `.eq('statut', 'actif')`
6. **Scripts SQL** : toujours exécuter `010_security_hardening.sql` après migration

---


## 🚀 Démarrage & Déploiement

```powershell
cd C:\GENESIS\genesis_app
npm install
npx next dev
# → http://localhost:3000  (redirige vers /copilote)
# → Health check: http://localhost:3000/admin/health
```


### Pages disponibles

| URL | Description |
|-----|-------------|
| `/` | → Redirect `/copilote` |
| `/copilote` | Copilote Media IA (chat + carte split screen) — page principale |
| `/map` | Carte POI + carreaux + Voronoï + Bataille d'Isochrones |
| `/login` | Connexion / Inscription |
| `/admin/ooh-import` | 🆕 Import OOH ArcGIS REST → global_ooh |
| `/admin/import` | Import Universel (CSV/XLSX/GeoJSON) |
| `/admin/carreaux-import` | Import Carreaux INSEE (CSV only) |
| `/admin/filosofi-import` | 🆕 Import batch Filosofi (CSV/Parquet) |
| `/admin/sources` | Gestion des sources de données |
| `/admin/organizations` | Gestion des organisations |
| `/admin/health` | Health Check système |

---


## 📝 Changelog

| Version | Date | Changements clés |
|---------|------|------------------|
| **7.0.0** | 2026-03-10 | **Migration import Filosofi** : CSV/Parquet (PapaParse, hyparquet, fzstd), endpoint `/api/admin/filosofi-import`, scripts SQL batch/view dynamiques, sécurité RLS renforcée (`010_security_hardening.sql`). Suppression dépendances MCP/Express, ajout shpjs, refonte UI admin, palette couleurs, labels, sidebar, et accessibilité. |
| **6.9.0** | 2026-03-09 | Design system refonte, token counter copilote, trimHistory optimisé, redirect `/copilote`, suppression Parse Prompt du menu. |
| **6.8.2** | 2026-03-09 | Import OOH ArcGIS : route `/api/admin/import-ooh/arcgis` streaming NDJSON. UI `/admin/ooh-import` : streaming temps réel, nommage post-import, historique `import_runs_ooh`. Outils IA `analyser_panneaux`, `scorer_panneaux_ooh`, `exporter_rapport_ooh` branchés sur `global_ooh`. |
| **6.8.1** | 2026-03-08 | Street View drawer au clic sur panneau OOH. Heatmap densité + GPU layers + dashboard POI + pagination illimitée. Fix timeout ORS adaptatif `calculate_audience_coverage`. Fix Gemini quota countdown. |
| **6.8.0** | 2026-03-08 | **Data Lake OOH** : table `global_ooh` + `import_runs_ooh` (migration `sql/005_global_ooh.sql`). **Multi-provider** Copilote : sélecteur header + badge statut temps réel. **MCP data.gouv.fr** : `sanitizeSchema()` Gemini-compat. `ChatMarkdown`, `DataGouvCard`. Outils IA : `calculate_audience_coverage`, `analyze_poi_synergy`, `classer_panneaux_audience`. |
| **6.6.0** | 2026-03-06 | Refonte import Shapefile : wizard 3 étapes, parser SHP/DBF/PRJ client-side, reprojection proj4. |
| **6.5.1** | 2026-03-03 | Fix "voronoï routier" + Panel Prompts `?` (6 catégories, 20 exemples). |
| **6.5.0** | 2026-03-03 | Rate limit 12 req/min/IP, AbortController ORS 12s, messages erreur friendlys. |
| **6.4.0** | 2026-03-03 | UI decomp — 6 hooks + 5 composants + page.tsx 160 lignes. |
| **6.3.0** | 2026-03-03 | Migration Vercel AI SDK v6 : streamText, useChat, DefaultChatTransport. |
| **6.0.0** | 2026-03-02 | Sécurité : requireAdmin() 18 routes, adminFetch(), createAdminClient() strict. |
| **5.9.0** | 2026-02-28 | Isochrones ORS dans Copilote (walk/drive/bike). |
| **5.7.0** | 2026-02-26 | Voronoï géométrique PostGIS + Carreaux choroplèthe INSEE. |
| **4.1.0** | 2026-02-24 | Renommage GEO.Prompt (ex-GENESIS), Health Check, versioning dynamique. |
| **1.0.0** | 2026-02-10 | Lancement initial, Parse Prompt IA, Supabase + PostGIS. |

---


## 🗺️ Roadmap — Types de cartes OOH/DOOH

Tableau de bord des visualisations cartographiques à implémenter (source : Google Sheet Projet OOH/DOOH).

### ✅ Effectué

| # | Carte | Implémentation |
|---|-------|----------------|
| 1 | **Isochrone / Isodistance** | ORS API, walk/bike/drive, caching, `isochrone_battle`, `applyIsochrones` |
| 2 | **Choroplèthe (Carroyage)** | Carreaux INSEE Filosofi 200m + 1km, `afficher_carreaux`, import Parquet |
| 3 | **Voronoï (Thiessen)** | Géométrique (`voronoi_analysis`) + Routier (`isochrone_battle`, anneaux 10/30/60/90/120 min) |
| 5 | **Valeurs Uniques (Catégories)** | `getCatColor()`, markers colorés par catégorie, `couleur_overrides` |
| 10 | **Carte de Chaleur (Heatmap)** | Layer `pois-heatmap` MapLibre, density >300 POIs, fade zoom 11-13 |

### ⏳ MVP Vital — Restant

| # | Carte | Cas d'usage OOH |
|---|-------|-----------------|
| 4 | **Clustering (Regroupement)** | Inventaire national 10k+ panneaux sans crash navigateur |

### ⏳ Différenciation

| # | Carte | Cas d'usage OOH |
|---|-------|-----------------|
| 6 | **Masquage (Polygones Inversés)** | Effet "Projecteur" : zone sélectionnée lumineuse, reste assombri |
| 7 | **Réseau Linéaire (Trafic)** | Visualiser TMJA, grands axes pour vendre des 4x3 routiers |
| 8 | **Symboles Proportionnels** | Taille du marker = volume d'impressions DOOH |
| 9 | **Bassin de Visibilité (Viewshed)** | Prouver qu'un panneau est visible depuis un carrefour |

### ⏳ Premium

| # | Carte | Cas d'usage OOH |
|---|-------|-----------------|
| 11 | **Hexagones (H3 / Hexbin)** | Alternative moderne au carroyage INSEE |
| 12 | **Carte Animée (Spatio-Temporelle)** | Dayparting DOOH : audience matin vs soir |
| 13 | **Extrusion 3D (Prismes 2.5D)** | Effet "Wahou" : population en 3D autour des gares |

### ⏳ Bonus Expert

| # | Carte |
|---|-------|
| 14 | Choroplèthe Bivariée — zones très peuplées ET forts revenus |
| 15 | Flux (Lignes de désir) — data transport GTFS |
| 16 | Diagrammes sur carte — répartition sociodémo par zone |
| 17 | Déplacement de Points — panneaux superposés (recto/verso) |
| 18 | Dasymétrique — exclure zones inhabitées du calcul audience |

> **Hors scope OOH** : Cartogramme (#19), Densité aléatoire (#20), Relief 3D (#21)

---


## 🐛 Problèmes connus & solutions

| Problème | Solution |
|----------|----------|
| `EPERM lstat LA_vsidol01` | Lancer PowerShell en tant que LA_vsidol01 |
| Port 3000 occupé | Next.js passe auto sur 3001 |
| `.env.local` pas chargé | Redémarrer le serveur Next.js |
| Bataille timeout (>280s) | Lancer d'abord depuis `/map` pour remplir le cache ORS |
| Routes admin 403 | Vérifier `SUPABASE_SERVICE_ROLE_KEY` dans `.env.local` |
| Gemini rate limit 429 | Billing non activé — switcher sur Mistral ou Claude |
| MCP data.gouv.fr timeout | Serveur parfois lent — timeout 5s, skippé silencieusement |

---

*GEO.Prompt v7.0.0 — AI Media Planning Platform*
