# GEO.Prompt — AI Media Planning Platform

> **Version** : 6.9.0 — 9 mars 2026
> **Anciennement** : GENESIS — rebaptisé GEO.Prompt en v4.1.0
> **Repo** : [vincedosi/geo_promptV2-](https://github.com/vincedosi/geo_promptV2-)

Plateforme SaaS B2B de géomarketing pour planneurs média outdoor (OOH).
L'utilisateur tape un prompt en français → l'IA extrait des filtres structurés → recherche géospatiale dans Supabase → affichage carte interactive.

---

## 📦 Stack technique

| Couche | Technologie |
|--------|-------------|
| **Framework** | Next.js 14 (App Router, TypeScript strict, Tailwind CSS) |
| **Base de données** | Supabase (PostgreSQL + PostGIS) |
| **Cartographie** | MapLibre GL JS + CARTO Light raster tiles (gratuit, sans token) |
| **IA / NLP** | Multi-provider via Vercel AI SDK v6 : Mistral AI (`mistral-small-latest`), Anthropic Claude (`claude-haiku-4-5-20251001`), Google Gemini (`gemini-2.5-flash`) — function calling, sélecteur dynamique |
| **MCP** | data.gouv.fr MCP (Streamable HTTP JSON-RPC) — recherche datasets open data FR, opt-in keyword-triggered |
| **Auth** | Supabase Auth (email/password, Bearer token) |
| **Parsing fichiers** | PapaParse (CSV), SheetJS (XLSX), natif (GeoJSON) |
| **Géocodage** | API BAN data.gouv.fr (adresses FR, gratuit) + proj4 (Lambert 93 → WGS84) |
| **Isochrones** | OpenRouteService API (ORS) — temps de trajet réel voiture/vélo/marche |
| **Clustering** | Supercluster (clustering côté client) |
| **Validation** | Zod (schémas JSON) |
| **UI** | Design system GEO.Prompt — terminal dark (Orbitron + Michroma + Inter) |

---

## 🏗️ Architecture

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
│   │   ├── ooh-import/page.tsx            ← 🆕 Import OOH ArcGIS REST → global_ooh (streaming, historique)
│   │   ├── import/page.tsx                ← Import Universel (CSV/XLSX/GeoJSON, 5 étapes)
│   │   ├── carreaux-import/page.tsx       ← Import Carreaux INSEE (upload web)
│   │   ├── sources/page.tsx               ← Gestion des sources de données
│   │   ├── organizations/page.tsx         ← Gestion multi-tenant
│   │   └── health/page.tsx                ← Health Check système
│   └── api/
│       ├── chat/route.ts                  ← Copilote IA (streamText, multi-provider, tools Zod, MCP data.gouv, trimHistory)
│       ├── providers/status/route.ts      ← Statut providers IA (quota Mistral, clé Claude/Gemini, cache 5min)
│       ├── search-poi/route.ts            ← Recherche POI par catégorie (paginé 1000/batch)
│       ├── search-poi/categories/route.ts ← Liste des catégories POI
│       ├── carreaux/route.ts              ← GET: sources / POST: GeoJSON bbox
│       ├── network-coverage/route.ts      ← Couverture réseau POI (ORS + PostGIS v3, cache)
│       ├── debug-coverage/route.ts        ← Diagnostic pipeline couverture (12 étapes)
│       ├── isochrone-battle/route.ts      ← Bataille d'Isochrones (ORS, cache, PostGIS)
│       ├── saved-maps/route.ts            ← Sauvegarde/chargement analyses
│       ├── saved-maps/[id]/route.ts       ← Détail/suppression analyse
│       └── admin/
│           ├── import-ooh/arcgis/route.ts ← 🆕 Import ArcGIS REST → global_ooh (NDJSON streaming)
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
│   │   ├── tools.ts                       ← Tous les outils IA (11 tools, schémas compressés)
│   │   ├── system-prompt.ts               ← Prompt système dynamique
│   │   └── providers.ts                   ← createModel(), getMaxRetries()
│   ├── mcp/
│   │   └── datagouv.ts                    ← Client MCP data.gouv.fr (JSON-RPC, sanitizeSchema Gemini-compat)
│   ├── auth.ts                            ← Helpers auth serveur (createAdminClient strict)
│   ├── isochrones/fetcher.ts              ← ORS API (isochrones, retry, AbortController)
│   ├── import/inserter.ts                 ← Insert batch Supabase (poi_france)
│   ├── poi/categories.ts                  ← Catégories POI
│   └── version.ts                         ← VERSION CENTRALE + changelog
├── sql/
│   ├── 005_global_ooh.sql                 ← 🆕 Table global_ooh + import_runs_ooh
│   ├── 009_calculate_network_coverage_v3.sql ← RPC coverage (single-scan, SRID fixé)
│   └── isochrone_battle_v1.sql            ← get_isochrone_battle() — ST_Difference
├── middleware.ts                           ← Middleware Next.js (passthrough)
├── .env.local                             ← Clés API (jamais commité)
└── .env.example                           ← Template variables d'environnement
```

---

## 🔒 Sécurité

Toutes les routes `app/api/admin/*` sont protégées par `requireAdmin()` :

```typescript
const profile = await requireAdmin(request);
if (!profile) return adminUnauthorized();
```

Les pages admin utilisent `adminFetch` — le Bearer token Supabase est injecté automatiquement :

```typescript
import { adminFetch } from '@/lib/admin-fetch';
const res = await adminFetch('/api/admin/sources');
```

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

### Tables

| Table | Description |
|-------|-------------|
| **poi** | Points d'intérêt (vue `poi_france` maintenue pour compatibilité) |
| **global_ooh** | 🆕 Data Lake panneaux OOH — toutes régies, toutes sources (source_ref = OBJECTID ArcGIS, statut: actif/inactif) |
| **import_runs_ooh** | 🆕 Historique des imports OOH (source, nb_inserts, nb_updates, durée) |
| **isochrones_cache** | Cache des isochrones ORS |
| **data_sources** | Sources de données importées |
| **carreaux_filosofi** | 2 310 582 carreaux 200m France métropolitaine (1,6 GB) |
| **organizations** | Organisations multi-tenant |
| **profiles** | Profils utilisateurs (role: super_admin / admin / client) |
| **saved_maps** | Analyses géospatiales sauvegardées |
| **france_borders** | MultiPolygon France métropolitaine (clip Voronoï) |

### Fonctions PostGIS

| Fonction | Description |
|----------|-------------|
| `get_carreaux_bbox(table, bbox, limit)` | Carreaux dans un viewport |
| `get_isochrone_battle(p_rings JSONB)` | Bataille d'Isochrones — ST_Difference pur |
| `get_voronoi_by_category(cat, ...)` | Voronoï géométrique par catégorie POI |
| `calculate_network_coverage_v3(...)` | Couverture démographique réseau POI |

---

## 🎯 Fonctionnalités

### Copilote Media IA (`/copilote`) — page principale

Chat conversationnel IA + carte interactive split screen.

**Multi-provider** (Vercel AI SDK v6) :
- **Gemini** `gemini-2.5-flash` — provider par défaut, thinking désactivé (budget=0)
- **Mistral** `mistral-small-latest`
- **Claude** `claude-haiku-4-5-20251001`

**Outils IA** (11 tools, schémas compressés pour réduire les tokens) :
- `analyser_zone_pois` — POI par zone + isochrones ORS
- `voronoi_analysis` — Voronoï géométrique par catégorie
- `isochrone_battle` — Bataille d'Isochrones (temps réel ORS)
- `afficher_carreaux` — choroplèthe carreaux INSEE
- `analyser_panneaux` — 🆕 panneaux OOH depuis `global_ooh` (pagination automatique 10k+)
- `calculer_couverture_reseau` — couverture démographique réseau POI
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

### 🆕 Data Lake OOH (`global_ooh`)

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

### Import Universel (`/admin/import`)

Pipeline 5 étapes : Upload → Mapping auto → Géolocalisation → Dry Run → Import SSE temps réel.

---

## ⚠️ Règles de développement

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

Toute nouvelle route dans `app/api/admin/` **doit** commencer par `requireAdmin()`.
Toute page admin **doit** utiliser `adminFetch()`.

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

---

## 🚀 Démarrage

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
| `/debug-coverage` | Diagnostic pipeline couverture réseau (12 étapes) |
| `/admin/ooh-import` | 🆕 Import OOH ArcGIS REST → global_ooh |
| `/admin/import` | Import Universel (CSV/XLSX/GeoJSON) |
| `/admin/carreaux-import` | Import Carreaux INSEE |
| `/admin/sources` | Gestion des sources de données |
| `/admin/organizations` | Gestion des organisations |
| `/admin/health` | Health Check système |

---

## 📝 Changelog

| Version | Date | Changements clés |
|---------|------|------------------|
| **6.9.0** | 2026-03-09 | **Design system refonte** : sidebar Orbitron/Michroma, palette #a855f7, terminal dark #050505. **Token counter** copilote : `messageMetadata` → `tok_in`/`tok_out` cumulatifs par session. **trimHistory optimisé** : strip `isochroneGeoJSON`, `voronoiGeoJSON.features`, `poisForMap.pois`, `features[]` en plus de `pois[]`. Route `/` → redirect `/copilote`. Suppression Parse Prompt du menu. |
| **6.8.2** | 2026-03-09 | Import OOH ArcGIS : route `/api/admin/import-ooh/arcgis` streaming NDJSON. UI `/admin/ooh-import` : streaming temps réel, nommage post-import, historique `import_runs_ooh`. Outils IA `analyser_panneaux`, `scorer_panneaux_ooh`, `exporter_rapport_ooh` branchés sur `global_ooh`. |
| **6.8.1** | 2026-03-08 | Street View drawer au clic sur panneau OOH. Heatmap densité + GPU layers + dashboard POI + pagination illimitée. Fix timeout ORS adaptatif `calculate_audience_coverage`. Fix Gemini quota countdown. |
| **6.8.0** | 2026-03-08 | **Data Lake OOH** : table `global_ooh` + `import_runs_ooh` (migration `sql/005_global_ooh.sql`). **Multi-provider** Copilote : sélecteur header + badge statut temps réel. **MCP data.gouv.fr** : `sanitizeSchema()` Gemini-compat. `ChatMarkdown`, `DataGouvCard`. Outils IA : `calculate_audience_coverage`, `analyze_poi_synergy`, `classer_panneaux_audience`. |
| **6.7.0** | 2026-03-07 | Outil `calculer_couverture_reseau` + RPC `calculate_network_coverage_v3`. Page `/debug-coverage` 12 étapes. |
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
| Couverture = 0 | Vérifier casse exacte colonne demo (`ind_18_24` pas `Ind_18_24`) |

---

*GEO.Prompt v6.9.0 — AI Media Planning Platform*
