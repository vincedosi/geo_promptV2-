# GEO.Prompt — AI Media Planning Platform

> **Version** : 6.7.0 — 7 mars 2026
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
| **IA / NLP** | Mistral AI (mistral-small-latest, function calling via Vercel AI SDK v6) |
| **Auth** | Supabase Auth (email/password, Bearer token) |
| **Parsing fichiers** | PapaParse (CSV), SheetJS (XLSX), natif (GeoJSON) |
| **Géocodage** | API BAN data.gouv.fr (adresses FR, gratuit) + proj4 (Lambert 93 → WGS84) |
| **Isochrones** | OpenRouteService API (ORS) — temps de trajet réel voiture/vélo/marche |
| **Clustering** | Supercluster (clustering côté client) |
| **Validation** | Zod (schémas JSON) |
| **UI** | Design system GEO.Prompt (dark mode, CSS custom) |

---

## 🏗️ Architecture

```
genesis_app/
├── app/
│   ├── page.tsx                           ← Page d'accueil (Parse Prompt IA)
│   ├── layout.tsx                         ← Layout global + GenesisNav sidebar
│   ├── map/page.tsx                       ← Carte POI + carreaux + Bataille d'Isochrones
│   ├── copilote/
│   │   ├── page.tsx                       ← Orchestration (~160 lignes, 6 hooks)
│   │   ├── _hooks/
│   │   │   ├── useMapInit.ts              ← Init MapLibre + markers
│   │   │   ├── useMapLayers.ts            ← Isochrones, Voronoï, Bataille, Carreaux
│   │   │   ├── useChatControls.ts         ← useChat + DefaultChatTransport
│   │   │   ├── useRateLimitHandler.ts     ← Countdown auto-retry Mistral 429
│   │   │   ├── useToolProcessor.ts        ← Traitement résultats outils IA
│   │   │   └── useSavedMaps.ts            ← Sauvegarde / chargement cartes
│   │   ├── _components/
│   │   │   ├── ChatPanel.tsx              ← Panel chat (messages, input, save/load)
│   │   │   ├── MapPanel.tsx               ← Panel carte (badges, toggles, légende)
│   │   │   ├── PromptsPanel.tsx           ← Panel aide prompts (6 catégories, 20 exemples)
│   │   │   ├── ZoneCard.tsx               ← Carte résumé zone analysée
│   │   │   └── TypingDots.tsx             ← Indicateur chargement IA
│   │   └── _lib/
│   │       └── constants.ts               ← circleGeoJSON, getCatColor
│   ├── dashboard/page.tsx                 ← Dashboard utilisateur (auth)
│   ├── login/page.tsx                     ← Login / Sign-up email
│   ├── admin/
│   │   ├── import/page.tsx                ← Import Universel (CSV/XLSX/GeoJSON, 5 étapes)
│   │   ├── carreaux-import/page.tsx       ← Import Carreaux INSEE (upload web)
│   │   ├── sources/page.tsx               ← Gestion des sources de données
│   │   ├── organizations/page.tsx         ← Gestion multi-tenant
│   │   └── health/page.tsx                ← Health Check système
│   └── api/
│       ├── parse-prompt/route.ts          ← Mistral → JSON filtres panneaux
│       ├── search-panneaux/route.ts       ← Filtres → panneaux Supabase (RPC PostGIS)
│       ├── search-poi/route.ts            ← Recherche POI par catégorie (paginé 1000/batch)
│       ├── search-poi/categories/route.ts ← Liste des catégories POI
│       ├── carreaux/route.ts              ← GET: sources (data_sources) / POST: GeoJSON bbox (PostgreSQL direct)
│       ├── chat/route.ts                  ← Copilote IA (streamText, 6 tools Zod, rate limit)
│       ├── network-coverage/route.ts      ← 📊 Couverture réseau POI (ORS + PostGIS v3, cache)
│       ├── debug-coverage/route.ts        ← 🔍 Diagnostic pipeline couverture (12 étapes)
│       ├── isochrone-battle/route.ts      ← ⚔️ Bataille d'Isochrones (ORS, cache, PostGIS)
│       ├── saved-maps/route.ts            ← Sauvegarde/chargement analyses
│       ├── saved-maps/[id]/route.ts       ← Détail/suppression analyse
│       ├── ai/parse-poi-query/route.ts    ← Mistral → filtres POI (carte IA)
│       ├── auth/[...auth]/route.ts        ← Auth endpoints
│       └── admin/                         ← 🔒 Toutes protégées par requireAdmin()
│           ├── import-poi/execute/route.ts ← SSE import POI en base
│           ├── import-geo/route.ts        ← Import batch Shapefile → carreaux_filosofi (PostgreSQL direct, unnest)
│           ├── import-geo/register/route.ts ← Enregistrement source dans data_sources
│           ├── import-geo/rename-columns/route.ts ← Renommage clés JSONB metadata
│           ├── sources/route.ts           ← CRUD sources
│           ├── sources/[id]/route.ts      ← GET/PATCH/DELETE source
│           ├── sources/[id]/meta-keys/route.ts
│           ├── sources/[id]/export/route.ts
│           ├── sources/[id]/summary/route.ts
│           ├── organizations/route.ts     ← CRUD organisations
│           ├── poi-categories/route.ts    ← CRUD catégories POI
│           ├── geocode/batch/route.ts     ← Géocodage batch BAN
│           ├── geocode/update/route.ts    ← Mise à jour coordonnées
│           ├── source-filters/route.ts    ← Filtres par source
│           ├── delete-source/route.ts     ← Suppression source
│           ├── delete-category/route.ts   ← Suppression catégorie
│           ├── verify-url/route.ts        ← Vérification URL
│           ├── health/route.ts            ← Health check (non protégé — diagnostic)
│           └── init-admin/route.ts        ← Init admin (ADMIN_INIT_KEY)
├── app/debug-coverage/page.tsx            ← 🔍 UI diagnostic couverture réseau (12 étapes, chronomètre)
├── components/
│   ├── GenesisNav.tsx                     ← Sidebar navigation
│   └── map/
│       ├── MapContainer.tsx               ← Carte + markers + carreaux + Voronoï + Bataille
│       ├── MapSidebar.tsx                 ← Sidebar résultats
│       ├── SearchBar.tsx                  ← Barre de recherche
│       └── hooks/
│           ├── useClusters.ts             ← Clustering Supercluster
│           ├── useMapPanels.ts            ← Panneaux latéraux
│           └── useMapViewport.ts          ← Viewport carte
├── lib/
│   ├── auth.ts                            ← Helpers auth serveur (createAdminClient strict)
│   ├── auth-client.ts                     ← Hooks auth client (useSession, useSignIn)
│   ├── admin-fetch.ts                     ← 🔒 adminFetch() — Bearer token automatique
│   ├── api/
│   │   ├── middleware.ts                  ← 🔒 requireAdmin() + adminUnauthorized()
│   │   └── errors.ts                      ← Gestion erreurs API
│   ├── geo/
│   │   ├── geometry.ts                    ← circleGeoJSON, tupleToGeoJSON, bboxFromPoints
│   │   ├── locations.ts                   ← resolveLocation, fetchPoisForLocation
│   │   └── fetchPois.ts                   ← fetchPois() avec filtres région/ville/département
│   ├── isochrones/
│   │   └── fetcher.ts                     ← ORS API (isochrones, retry, AbortController 12s)
│   ├── import/
│   │   ├── file-parser.ts                 ← Parse CSV/XLSX/GeoJSON
│   │   ├── column-detector.ts             ← Détection automatique colonnes
│   │   ├── geocoder.ts                    ← Géocodage BAN + Lambert93
│   │   ├── inserter.ts                    ← Insert batch Supabase
│   │   ├── validator.ts                   ← Validation avant import
│   │   └── types.ts                       ← Types import
│   ├── map/
│   │   ├── config.ts                      ← Design tokens carte
│   │   ├── types.ts                       ← Types carte
│   │   └── utils.ts                       ← Utilitaires géo
│   ├── poi/categories.ts                  ← Catégories POI
│   ├── geo-resolver.ts                    ← Résolution géo (dept/villes/régions)
│   ├── supabase.ts                        ← Client Supabase partagé
│   └── version.ts                         ← VERSION CENTRALE + changelog
├── types/
│   ├── poi.ts                             ← PoiRow, PoiCategory
│   ├── spatial.ts                         ← ZoneData, IsochroneData, VoronoiData, CarreauxData, SavedMap
│   └── api.ts                             ← ApiError, PaginatedResponse
├── sql/
│   ├── 001_unify_poi_table.sql            ← Table poi_france
│   ├── 002_get_carreaux_bbox.sql          ← RPC bbox carreaux (avec validations sécurité)
│   ├── 007_calculate_network_coverage.sql ← v1 calculate_network_coverage (obsolète, timeout)
│   ├── 008_calculate_network_coverage_v2.sql ← v2 (obsolète, CTE non matérialisé — timeout)
│   ├── 009_calculate_network_coverage_v3.sql ← ✅ v3 ACTIVE — single-scan, SRID fixé
│   ├── isochrone_battle_v1.sql            ← ⚔️ get_isochrone_battle() — ST_Difference pur
│   └── setup_carreaux.sql                 ← Setup tables carreaux INSEE
├── middleware.ts                           ← Middleware Next.js (passthrough)
├── .env.local                             ← Clés API (jamais commité)
└── .env.example                           ← Template variables d'environnement
```

---

## 🔒 Sécurité (v6.0.0)

### Architecture d'authentification Admin

Toutes les routes `app/api/admin/*` sont protégées par `requireAdmin()` :

```typescript
// lib/api/middleware.ts
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);   // ← vérifie Bearer token + rôle super_admin
  if (!profile) return adminUnauthorized();       // ← 403 standardisé
  // ... logique métier
}
```

### adminFetch — Wrapper côté client

Les pages admin utilisent `adminFetch` au lieu de `fetch` — le Bearer token Supabase est injecté automatiquement :

```typescript
// lib/admin-fetch.ts
import { adminFetch } from '@/lib/admin-fetch';

const res = await adminFetch('/api/admin/sources');  // ← Authorization: Bearer <token>
```

### createAdminClient — Strict

`createAdminClient()` lève une erreur explicite si `SUPABASE_SERVICE_ROLE_KEY` est absente (plus de fallback silencieux sur la clé anon).

---

## 🔑 Variables d'environnement (.env.local)

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...    ← OBLIGATOIRE pour les opérations admin

# IA
MISTRAL_API_KEY=sk_...

# Isochrones ORS
ORS_API_KEY=...                     ← Requis pour la Bataille d'Isochrones

# Admin bootstrap
ADMIN_INIT_KEY=...                  ← Clé secrète pour créer le premier super_admin
SUPABASE_DB_URL=postgresql://postgres:...@db.xxx.supabase.co:5432/postgres  ← Requis pour import-geo (PostgreSQL direct)

# Interne
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Vérifier la config : **http://localhost:3000/admin/health**

---

## 🗄️ Base de données Supabase

### Tables

| Table | Description |
|-------|-------------|
| **poi_france** | Points d'intérêt (lycées, CIRFA, gares...) avec geom PostGIS |
| **panneaux_affichage** | Panneaux d'affichage publicitaire géolocalisés |
| **isochrones_cache** | Cache des isochrones ORS (clé unique par CIRFA + palier + mode) |
| **data_sources** | Sources de données importées (type: poi / carreaux) |
| **carreaux_filosofi** | 2 310 582 carreaux 200m France métropolitaine (1,6 GB) — SRID 4326, metadata JSONB, index GIST |
| **organizations** | Organisations multi-tenant |
| **profiles** | Profils utilisateurs (role: super_admin / admin / client) |
| **saved_maps** | Analyses géospatiales sauvegardées |
| **france_borders** | MultiPolygon France métropolitaine (clip Voronoï) |

### Fonctions PostGIS

| Fonction | Description |
|----------|-------------|
| `get_carreaux_bbox(table, bbox, limit)` | Carreaux dans un viewport (index GIST, validations sécurité) |
| `get_isochrone_battle(p_rings JSONB)` | ⚔️ Bataille d'Isochrones — ST_Difference pur, zéro Voronoï |
| `get_voronoi_by_category(cat, ...)` | Voronoï géométrique par catégorie POI, clip france_borders |
| `panneaux_near_point(lat, lng, rayon_m)` | Panneaux dans un rayon GPS |
| `calculate_network_coverage_v3(features, col, mil)` | 📊 Couverture démographique réseau POI (single-scan, LATERAL, SRID fixé) |
| `import_carreaux_batch(...)` | Import batch carreaux via RPC (HTTPS, pas de connexion directe) |

> ⚠️ Exécuter `sql/isochrone_battle_v1.sql` dans le Supabase SQL Editor avant d'utiliser la Bataille d'Isochrones.
> ✅ `calculate_network_coverage_v3` déployée via MCP migration — déjà active en production.

---

## 🎯 Fonctionnalités

### Carte Interactive POI (`/map`)
- Tous les POI par catégorie avec filtres dynamiques
- **Markers DOM** (pas de GeoJSON layers — robuste au chargement du style)
- **Couche carreaux INSEE** — choroplèthe polygon, sélecteur métrique dynamique, auto-zoom
- **Voronoï géométrique** — zones d'influence par catégorie POI, clip France métro
- **⚔️ Bataille d'Isochrones** — sectorisation par temps de trajet réel ORS :
  - Sélecteur catégorie (CIRFA, lycée, etc.) + mode transport (🚗🚶🚲)
  - Durée configurable : 60 / 90 / 120 / 150 / 180 min
  - Filtres région / département
  - Palette par CIRFA, opacité par palier temporel, bordures 3px
  - Légende dynamique avec liste des CIRFA
  - Cache ORS par CIRFA × palier (requêtes suivantes quasi-instantanées)
- Recherche IA en langage naturel
- Export Excel des POIs affichés

### ⚔️ Bataille d'Isochrones — Algorithme

```
Input : [{cirfa_id, nom, lat, lng, palier (10/30/60/90/120 min), geojson}]
        trié par palier ASC (plus petit temps = priorité absolue)

master_mask = EMPTY
Pour chaque polygone (ordre palier ASC, puis cirfa_id ASC) :
  pure_ring  = ST_Difference(polygone, master_mask)
  RETURN pure_ring avec {cirfa_id, palier}         ← feature_type: "ring"
  master_mask = ST_Union(master_mask, pure_ring)

Passe 2 : union par CIRFA → feature_type: "border" (bordures 3px frontend)
```

**Règle : "le plus petit temps gagne"** — chaque zone est attribuée au CIRFA le plus proche en temps de trajet réel. Zéro Voronoï, uniquement des vrais isochrones ORS.

**Cache** : clé `battle__{cat}__{cirfa_id}__{L}min__{mode}` dans `isochrones_cache`. Premier appel (~1-2 min pour la France entière), appels suivants <5 secondes.

### 📊 Couverture Réseau POI (`/api/network-coverage`)

Calcule combien de personnes sont atteignables dans un temps de trajet donné depuis l'ensemble des POI d'une catégorie.

#### Prompt de référence (testé et validé)

```
Calcule la couverture réseau des CIRFA en Bretagne pour les 18-24 ans en voiture à 30 minutes.
```

**Résultat attendu** : couverture ~118 000 ind_18_24, 4 CIRFAs, ~52% de taux de pénétration, breakdown par CIRFA.

#### Paramètres du tool `calculer_couverture_reseau`

| Paramètre | Valeur | Description |
|-----------|--------|-------------|
| `poi_category` | `cirfa` | Catégorie POI |
| `region` | `Bretagne` | Filtre géographique (région / ville / département) |
| `travel_time_minutes` | `30` | Temps de trajet en minutes |
| `mode` | `drive` | Mode transport : `drive` / `walk` / `bike` |
| `target_demo_column` | `ind_18_24` | Colonne démographique dans `metadata` |
| `target_demo_label` | `Jeunes 18-24 ans` | Label affiché dans le rapport |

#### Colonnes démographiques disponibles (`carreaux_filosofi.metadata`)

| Clé | Description |
|-----|-------------|
| `Ind` | Population totale |
| `ind_18_24` | Jeunes 18-24 ans |
| `Ind_25_39` | 25-39 ans |
| `Ind_40_54` | 40-54 ans |
| `Ind_55_64` | 55-64 ans |
| `Ind_65_79` | 65-79 ans |
| `ind_80p` | 80 ans et plus |
| `ind_6_10` | 6-10 ans |
| `ind_11_17` | 11-17 ans |
| `Men` | Ménages |
| `men_pauv` | Ménages pauvres |

#### Architecture technique

```
1. fetchPois() — 4 CIRFAs Bretagne depuis poi_france
2. ORS batch — 1 isochrone 30min voiture par CIRFA (batch 5, timeout 8s)
3. JS simplify — round4 + dedup des coordonnées (réduction ~80% du poids)
4. supabase.rpc('calculate_network_coverage_v3') :
   ├── ST_Union des 4 isochrones → v_union_geom (SRID 4326 forcé)
   ├── UN seul scan carreaux_filosofi (207k carreaux dans le bbox Bretagne)
   │   └── FILTER WHERE ST_Intersects(c.geom, v_union_geom) → coverage
   │   └── SUM total → total_pop
   └── LATERAL par POI → breakdown_by_poi (1 GIST scan / CIRFA)
5. Cache → isochrones_cache (clé: network__cirfa__bretagne__30min__drive)
```

**Timing** : ~15s total (1s RPC, 2s ORS, reste cache/réseau).

#### Diagnostic

Page de debug complète : **http://localhost:3000/debug-coverage**
- 12 étapes : catégories → POIs → ORS → data_sources → RPC v3 direct → API complète
- Paramètres configurables (région, minutes, mode, colonne demo, max ORS)
- Chronomètre par étape

---

### Copilote Media IA (`/copilote`)
Chat conversationnel IA + carte interactive en split screen.
- Mistral AI function calling via **Vercel AI SDK v6** (`streamText`, `useChat`, `DefaultChatTransport`)
- **6 outils** :
  - `analyser_zone_pois` — recherche POI par zone géographique + isochrones ORS
  - `voronoi_analysis` — Voronoï géométrique par catégorie (à vol d'oiseau, instantané)
  - `isochrone_battle` — ⚔️ Voronoï Routier / Bataille d'Isochrones (temps réel ORS, ~1-2 min)
  - `afficher_carreaux` — choroplèthe carreaux INSEE sur la carte
  - `analyser_panneaux` — panneaux OOH géolocalisés (table panneaux_affichage)
  - `calculer_couverture_reseau` — 📊 Couverture démographique réseau POI (ORS + PostGIS)
- **Rate limit** : 12 req/min/IP in-memory, countdown auto-retry avec délai exact
- **AbortController ORS** : timeout 12s par batch, délai adaptatif (5s timeout / 20s rate limit)
- **Panel Prompts `?`** : 6 catégories de prompts cliquables avec description du résultat attendu
- ZoneCard résultats, légende dynamique, sauvegarde/chargement cartes
- Messages d'erreur friendlys (Bataille timeout, Voronoï erreur)

### Import Universel (`/admin/import`)
Pipeline 5 étapes : Upload → Mapping auto → Géolocalisation (GPS/BAN/Lambert93) → Dry Run → Import SSE temps réel.

### Back-Office (toutes routes protégées par `requireAdmin()`)
- **Sources** — CRUD, filtres, partage inter-organisations, éditeur de filtres dynamique
- **Organisations** — Multi-tenant, gestion membres
- **Health Check** — Diagnostic Supabase, variables d'environnement, tables

---

## ⚠️ Règles de développement

### 1. Versioning (obligatoire)

**Fichier central** : `lib/version.ts`

```typescript
export const APP_VERSION = '6.5.1'; // ← TOUJOURS INCRÉMENTER
```

| Type | Version | Exemple |
|------|---------|---------|
| Refonte majeure / breaking / sécurité | MAJOR | 5.x → 6.0.0 |
| Nouvelle feature | MINOR | 6.0.0 → 6.1.0 |
| Bugfix / logs | PATCH | 6.0.0 → 6.0.1 |

### 2. Sécurité routes admin

Toute nouvelle route dans `app/api/admin/` **doit** commencer par :

```typescript
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

const profile = await requireAdmin(request);
if (!profile) return adminUnauthorized();
```

Toute page admin qui appelle une route admin **doit** utiliser `adminFetch` :

```typescript
import { adminFetch } from '@/lib/admin-fetch';
const res = await adminFetch('/api/admin/sources');
```

### 3. Vercel AI SDK v6 — Patterns

```typescript
// Backend (chat/route.ts)
const result = streamText({
  model: createMistral(...)('mistral-small-latest'),
  system: '...',
  messages: await convertToModelMessages(messages),  // ← async!
  stopWhen: stepCountIs(3),
  tools: { monOutil: { inputSchema: z.object({...}), execute: async (input) => {...} } }
});
return result.toUIMessageStreamResponse();

// Frontend
const { messages, sendMessage, status } = useChat({
  transport: new DefaultChatTransport({ api: '/api/chat', prepareSendMessagesRequest: ... })
});
// Tool results dans msg.parts — type 'tool-{name}', state 'output-available', champ output
```

### 4. Logs structurés

```typescript
// ✅ BON
console.log('[INSERTER] Start: 687 lignes, type="poi"');
console.error('[battle/ORS] Rate limit batch 3/24, palier 60min');

// ❌ MAUVAIS
console.log('done');
```

| Module | Préfixe |
|--------|---------|
| Import | `[INSERTER]` / `[EXECUTE]` |
| Bataille | `[battle]` / `[battle/ORS]` |
| Chat IA | `[chat]` / `[chat/isochrone_battle]` |
| Carte | `[MapContainer]` / `[MapPage]` |
| Carreaux API | `[carreaux]` |
| Copilote IA | `[copilote]` |
| Auth | `[auth]` |

### 5. Règles générales

1. **Ne jamais committer les clés API** — `.env.local` est dans `.gitignore`
2. **ON CONFLICT DO NOTHING** sur tous les inserts
3. **Toute route admin** → `requireAdmin()` en première ligne
4. **Tout appel admin côté client** → `adminFetch()` (jamais `fetch()` nu)
5. **Inserts POI via Supabase JS** (HTTPS) — **imports géo bulk via PostgreSQL direct** (`import-geo`, `carreaux/route.ts`) pour contourner les limites PostgREST

---

## 🚀 Démarrage

```powershell
cd C:\GENESIS\genesis_app
npm install
npx next dev
# → http://localhost:3000
# → Health check: http://localhost:3000/admin/health
```

### Pages disponibles

| URL | Description |
|-----|-------------|
| `/` | Parse Prompt IA → recherche panneaux |
| `/map` | Carte POI + carreaux choroplèthe + Voronoï + Bataille d'Isochrones |
| `/copilote` | Copilote Media IA (chat + carte split screen, 6 outils) |
| `/dashboard` | Dashboard utilisateur |
| `/login` | Connexion / Inscription |
| `/debug-coverage` | 🔍 Diagnostic pipeline couverture réseau (12 étapes, chronomètre) |
| `/admin/import` | Import Universel (CSV/XLSX/GeoJSON) |
| `/admin/carreaux-import` | Import Carreaux INSEE |
| `/admin/sources` | Gestion des sources de données |
| `/admin/organizations` | Gestion des organisations |
| `/admin/health` | Health Check système |

---

## 🔄 Plan de refactoring

| # | Itération | Statut | Détail |
|---|-----------|--------|--------|
| 1 | **Sécurité** | ✅ Terminé | `requireAdmin()`, `adminFetch()`, fallback anon key corrigé |
| 2 | **Contrat de Types** | ✅ Terminé | `types/poi.ts`, `types/spatial.ts`, `types/api.ts` |
| 3 | **Couche Service** | ✅ Terminé | `lib/geo/geometry.ts`, `lib/geo/locations.ts`, `lib/isochrones/fetcher.ts` |
| 4 | **Découpage UI** | ✅ Terminé | 6 hooks, 5 composants, `page.tsx` ~160 lignes |
| 5 | **Rate Limiting & Robustesse** | ✅ Terminé | Rate limit 12 req/min, AbortController ORS 12s, messages erreur |
| 6 | **Import Shapefile** | ✅ Terminé | Parser SHP/DBF/PRJ client-side, reprojection proj4 browser, API PostgreSQL direct (unnest), sécurité fully parameterized |

---

## 📝 Changelog

| Version | Date | Changements clés |
|---------|------|-------------------|
| **6.7.0** | 2026-03-07 | Outil `calculer_couverture_reseau` : RPC `calculate_network_coverage_v3` déployée (single-scan FILTER, LATERAL MATERIALIZED, SRID 4326 forcé). Fix timeout PostgREST 125s : CTE non-matérialisé + SRID perdu par ST_SimplifyPreserveTopology. Page `/debug-coverage` 12 étapes. Carreaux France entière : 2,3M carreaux 1,6 GB. |
| **6.6.0** | 2026-03-06 | Refonte import Shapefile : wizard 3 étapes, parser SHP/DBF/PRJ client-side, reprojection proj4 browser. API `/import-geo` PostgreSQL direct + unnest paramétrisé. Sécurité : `sql.unsafe()` remplacé par requêtes fully parameterized. |
| **6.5.1** | 2026-03-03 | Fix "voronoï routier" → `isochrone_battle` + Panel Prompts `?` (6 catégories, 20 exemples cliquables) |
| **6.5.0** | 2026-03-03 | Itér. 5 : rate limit 12 req/min/IP, AbortController ORS 12s, messages erreur friendlys, outil `analyser_panneaux` |
| **6.4.1** | 2026-03-03 | DB audit : suppression code mort (engine.ts, spatial/route.ts) |
| **6.4.0** | 2026-03-03 | Itér. 4 : UI decomp — 6 hooks + 5 composants + page.tsx 160 lignes |
| **6.3.0** | 2026-03-03 | Migration Vercel AI SDK v6 : streamText, useChat, DefaultChatTransport |
| **6.2.0** | 2026-03-03 | Itér. 3 : lib/geo/geometry.ts, lib/geo/locations.ts, lib/isochrones/fetcher.ts |
| **6.1.0** | 2026-03-03 | Itér. 2 : types/poi.ts, types/spatial.ts, types/api.ts |
| **6.0.0** | 2026-03-02 | Itér. 1 : requireAdmin() 18 routes, adminFetch(), createAdminClient() strict |
| **5.12.0** | 2026-02-28 | france_borders, get_voronoi_by_category clip ST_Intersection |
| **5.9.0** | 2026-02-28 | Isochrones ORS dans Copilote (walk/drive/bike) |
| **5.7.0** | 2026-02-26 | Voronoï géométrique PostGIS + outil Mistral |
| **5.6.0** | 2026-02-26 | Carreaux choroplèthe (INSEE Filosofi), sélecteur métrique |
| **5.5.0** | 2026-02-26 | IA filtres metadata (libelle_nature, hebergement…) |
| **5.0.0** | 2026-02-24 | Inserter Supabase JS (HTTPS), suppression PostgreSQL direct |
| **4.1.0** | 2026-02-24 | Renommage GEO.Prompt, Health Check, versioning dynamique |
| **4.0.0** | 2026-02-23 | Back-office complet (Organizations, Sources, Auth) |
| **3.0.0** | 2026-02-20 | Import Universel 5 étapes, géocodage BAN, Carreaux INSEE |
| **1.0.0** | 2026-02-10 | Lancement initial, Parse Prompt IA, Supabase + PostGIS |

---

## 🐛 Problèmes connus & solutions

| Problème | Solution |
|----------|----------|
| `EPERM lstat LA_vsidol01` | Lancer PowerShell en tant que LA_vsidol01 |
| `npm : scripts désactivés` | `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force` |
| Port 3000 occupé | Next.js passe auto sur 3001 |
| `.env.local` pas chargé | Redémarrer le serveur Next.js |
| Firewall bloque PostgreSQL | Résolu en v5.0 — client Supabase JS (HTTPS port 443) |
| Bataille : message brut dans le chat | Résolu en v6.5.0 — messages friendlys dans useToolProcessor |
| Bataille timeout (>280s) | Lancer d'abord depuis `/map` pour remplir le cache ORS, puis réessayer depuis le copilote |
| Routes admin 403 | Vérifier que `SUPABASE_SERVICE_ROLE_KEY` est configurée (non placeholder) |
| "Voronoï routier" ne fait rien | Résolu en v6.5.1 — déclenche désormais `isochrone_battle` |
| Nouveau fichier non chargé (dev) | Redémarrer le serveur Next.js (`Ctrl+C` puis `npm run dev`) |
| Couverture réseau timeout 125s `upstream request timeout` | Résolu en v6.7.0 — deux bugs : (1) CTE `iso` non-matérialisé dans EXISTS → ST_GeomFromGeoJSON exécuté 207k fois, (2) SRID perdu par ST_SimplifyPreserveTopology → mixed SRID 4326 vs 0. Fix : v3 avec v_union_geom scalaire + FILTER + LATERAL MATERIALIZED |
| `calculate_network_coverage_v3` absente | Exécuter `sql/009_calculate_network_coverage_v3.sql` dans Supabase SQL Editor (ou via MCP `apply_migration`) |
| Couverture = 0 alors que des carreaux existent | Vérifier la colonne `demo_col` dans `/debug-coverage` step 8 — casse exacte (`ind_18_24` pas `Ind_18_24`) |

---

*GEO.Prompt v6.7.0 — AI Media Planning Platform*
