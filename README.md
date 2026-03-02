# GEO.Prompt — AI Media Planning Platform

> **Version** : 6.0.0 — 2 mars 2026
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
| **IA / NLP** | Mistral AI (mistral-small-latest, JSON mode, function calling) |
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
│   ├── copilote/page.tsx                  ← Copilote Media IA (chat + carte split)
│   ├── dashboard/page.tsx                 ← Dashboard utilisateur (auth)
│   ├── login/page.tsx                     ← Login / Sign-up email
│   ├── admin/
│   │   ├── import/page.tsx                ← Import Universel (CSV/XLSX/GeoJSON, 5 étapes)
│   │   ├── carreaux-import/page.tsx       ← Import Carreaux INSEE (upload web)
│   │   ├── sources/page.tsx               ← Gestion des sources de données
│   │   ├── organizations/page.tsx         ← Gestion multi-tenant
│   │   └── health/page.tsx                ← Health Check système
│   ├── api/
│   │   ├── parse-prompt/route.ts          ← Mistral → JSON filtres panneaux
│   │   ├── search-panneaux/route.ts       ← Filtres → panneaux Supabase (RPC PostGIS)
│   │   ├── search-poi/route.ts            ← Recherche POI par catégorie (paginé 1000/batch)
│   │   ├── search-poi/categories/route.ts ← Liste des catégories POI
│   │   ├── carreaux/route.ts              ← GET: sources / POST: GeoJSON FeatureCollection
│   │   ├── chat/route.ts                  ← Copilote IA (Mistral function calling, agentique)
│   │   ├── isochrone-battle/route.ts      ← ⚔️ Bataille d'Isochrones (ORS, cache, PostGIS)
│   │   ├── spatial/route.ts               ← Moteur géospatial (Voronoï, isochrones, proximité)
│   │   ├── saved-maps/route.ts            ← Sauvegarde/chargement analyses
│   │   ├── saved-maps/[id]/route.ts       ← Détail/suppression analyse
│   │   ├── ai/parse-poi-query/route.ts    ← Mistral → filtres POI (carte IA)
│   │   ├── auth/[...auth]/route.ts        ← Auth endpoints
│   │   └── admin/                         ← 🔒 Toutes protégées par requireAdmin()
│   │       ├── import-poi/execute/route.ts ← SSE import POI en base
│   │       ├── import-carreaux/route.ts   ← Import carreaux INSEE
│   │       ├── sources/route.ts           ← CRUD sources
│   │       ├── sources/[id]/route.ts      ← GET/PATCH/DELETE source
│   │       ├── sources/[id]/meta-keys/route.ts
│   │       ├── sources/[id]/export/route.ts
│   │       ├── sources/[id]/summary/route.ts
│   │       ├── organizations/route.ts     ← CRUD organisations
│   │       ├── poi-categories/route.ts    ← CRUD catégories POI
│   │       ├── geocode/batch/route.ts     ← Géocodage batch BAN
│   │       ├── geocode/update/route.ts    ← Mise à jour coordonnées
│   │       ├── source-filters/route.ts    ← Filtres par source
│   │       ├── delete-source/route.ts     ← Suppression source
│   │       ├── delete-category/route.ts   ← Suppression catégorie
│   │       ├── verify-url/route.ts        ← Vérification URL
│   │       ├── preview-carreaux/route.ts  ← Prévisualisation carreaux
│   │       ├── health/route.ts            ← Health check (non protégé — diagnostic)
│   │       └── init-admin/route.ts        ← Init admin (ADMIN_INIT_KEY)
│   └── components/
│       ├── AISearchInput.tsx              ← Barre de recherche IA (robot pixel art animé)
│       ├── MapIntegrated.tsx / MapIntegratedClient.tsx
│       └── MaplibreMap.tsx / MaplibreMapClient.tsx
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
│   ├── isochrones/
│   │   └── fetcher.ts                     ← ORS API (isochrones, retry, cache)
│   ├── spatial/
│   │   └── engine.ts                      ← Moteur Mistral géospatial (4 outils)
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
├── sql/
│   ├── 001_unify_poi_table.sql            ← Table poi_france
│   ├── 002_get_carreaux_bbox.sql          ← RPC bbox carreaux (avec validations sécurité)
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
| **`<carreaux_table>`** | Tables dynamiques carreaux INSEE (idcar + geom + metadata JSONB) |
| **organizations** | Organisations multi-tenant |
| **profiles** | Profils utilisateurs (role: super_admin / admin / client) |
| **saved_maps** | Analyses géospatiales sauvegardées |

### Fonctions PostGIS

| Fonction | Description |
|----------|-------------|
| `get_carreaux_bbox(table, bbox, limit)` | Carreaux dans un viewport (index GIST, validations sécurité) |
| `get_isochrone_battle(p_rings JSONB)` | ⚔️ Bataille d'Isochrones — ST_Difference pur, zéro Voronoï |
| `get_voronoi_by_category(cat, ...)` | Voronoï géométrique par catégorie POI |
| `panneaux_near_point(lat, lng, rayon_m)` | Panneaux dans un rayon GPS |
| `create_carreaux_table(table_name)` | Crée une table carreaux dynamique |
| `drop_carreaux_table(table_name)` | Supprime une table carreaux |

> ⚠️ Exécuter `sql/isochrone_battle_v1.sql` dans le Supabase SQL Editor avant d'utiliser la Bataille d'Isochrones.

---

## 🎯 Fonctionnalités

### Carte Interactive POI (`/map`)
- Tous les POI par catégorie avec filtres dynamiques
- **Markers DOM** (pas de GeoJSON layers — robuste au chargement du style)
- **Couche carreaux INSEE** — choroplèthe polygon, sélecteur métrique dynamique, auto-zoom
- **Voronoï géométrique** — zones d'influence par catégorie POI
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

### Copilote Media IA (`/copilote`)
Chat conversationnel IA + carte interactive en split screen.
- Mistral AI function calling — 4 outils :
  - `analyser_zone_pois` — recherche POI par zone géographique
  - `voronoi_analysis` — Voronoï géométrique par catégorie
  - `isochrone_battle` — ⚔️ Bataille d'Isochrones (avec gestion erreur et timeout 280s)
  - `afficher_carreaux` — choroplèthe INSEE sur la carte
- ZoneCard résultats, légende dynamique, suggestions de prompts
- Affichage de l'erreur Bataille directement dans l'UI (sans paraphrase Mistral)

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
export const APP_VERSION = '6.0.0'; // ← TOUJOURS INCRÉMENTER
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

### 3. Logs structurés

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
| Spatial | `[spatial]` |

### 4. Règles générales

1. **Ne jamais committer les clés API** — `.env.local` est dans `.gitignore`
2. **ON CONFLICT DO NOTHING** sur tous les inserts
3. **Toute route admin** → `requireAdmin()` en première ligne
4. **Tout appel admin côté client** → `adminFetch()` (jamais `fetch()` nu)
5. **Tout insert passe par le client Supabase JS** (HTTPS, pas de connexion PostgreSQL directe)

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
| `/copilote` | Copilote Media IA (chat + carte split screen) |
| `/dashboard` | Dashboard utilisateur |
| `/login` | Connexion / Inscription |
| `/admin/import` | Import Universel (CSV/XLSX/GeoJSON) |
| `/admin/carreaux-import` | Import Carreaux INSEE |
| `/admin/sources` | Gestion des sources de données |
| `/admin/organizations` | Gestion des organisations |
| `/admin/health` | Health Check système |

---

## 🔄 Plan de refactoring (itérations en cours)

| # | Itération | Statut | Détail |
|---|-----------|--------|--------|
| 1 | **Sécurité** | ✅ Terminé | `requireAdmin()`, `adminFetch()`, fallback anon key corrigé |
| 2 | **Contrat de Types** | ⏳ À faire | `types/poi.ts`, `types/spatial.ts`, dédupliquer définitions |
| 3 | **Couche Service** | ⏳ À faire | `services/battle.ts`, supprimer fetch internes, thin controllers |
| 4 | **Découpage UI** | ⏳ À faire | Découper `copilote` (2024 lignes), `MapContainer` (630 lignes) |
| 5 | **Rate Limiting & Robustesse** | ⏳ À faire | Rate limit `/api/chat`, `/api/isochrone-battle`, logs JSON |
| 6 | **Subprocess Python** | ⏳ À faire | Migrer `import-carreaux` vers CLI autonome cross-platform |

---

## 📝 Changelog

| Version | Date | Changements clés |
|---------|------|-------------------|
| **6.0.0** | 2026-03-02 | Audit sécurité : `requireAdmin()` sur 18 routes admin, `adminFetch()`, `createAdminClient()` strict, nouveau repo geo_promptV2- |
| **5.10.0** | 2026-03-01 | Spatial Engine : `lib/spatial/engine.ts`, Voronoï PostGIS, saved maps, `/api/spatial` |
| **5.9.0** | 2026-03-01 | ⚔️ Bataille d'Isochrones : `/api/isochrone-battle`, outil Mistral, layers MapLibre, page /map sidebar |
| **5.8.0** | 2026-03-01 | ORS isochrones : `lib/isochrones/fetcher.ts`, cache `isochrones_cache`, retry logic |
| **5.7.0** | 2026-02-28 | Voronoï géométrique : `get_voronoi_by_category` PostGIS, outil Mistral `voronoi_analysis` |
| **5.6.0** | 2026-02-26 | Carreaux choroplèthe : sélecteur métrique dynamique, auto-zoom bbox, toggle Copilote |
| **5.5.0** | 2026-02-26 | IA : filtres metadata, correspondances LP/LG/LGT/SEP |
| **5.4.0** | 2026-02-26 | Copilote : cercles individuels rayon_poi_metres, légende, ZoneCard |
| **5.3.0** | 2026-02-26 | Copilote : layout fullscreen chat+carte, Mistral function calling |
| **5.2.0** | 2026-02-25 | IA multi-villes/régions/dept, export Excel, robot pixel art |
| **5.1.0** | 2026-02-25 | Sources : éditeur filtres dynamique, sélection colonnes import |
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
| Bataille : "Je n'ai pas réussi" | Vérifier `ORS_API_KEY` dans `.env.local` + logs `[battle/ORS]` dans la console serveur |
| Bataille timeout (>280s) | Lancer d'abord depuis `/map` pour remplir le cache ORS, puis réessayer depuis le copilote |
| Routes admin 403 | Vérifier que `SUPABASE_SERVICE_ROLE_KEY` est configurée (non placeholder) |

---

*GEO.Prompt v6.0.0 — AI Media Planning Platform*
