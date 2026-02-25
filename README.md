# GEO.Prompt — AI Media Planning Platform

> **Version** : 5.0.0 — 24 février 2026
> **Anciennement** : GENESIS — rebaptisé GEO.Prompt en v4.1.0
> **Repo** : [vincedosi/GENENSIS](https://github.com/vincedosi/GENENSIS)

Plateforme SaaS B2B de géomarketing pour planneurs média outdoor (OOH).
L'utilisateur tape un prompt en français → l'IA extrait des filtres structurés → recherche géospatiale dans Supabase → affichage carte interactive.

---

## 📦 Stack technique

| Couche | Technologie |
|--------|-------------|
| **Framework** | Next.js 14 (App Router, TypeScript strict, Tailwind CSS) |
| **Base de données** | Supabase (PostgreSQL + PostGIS) |
| **Cartographie** | MapLibre GL JS + OpenStreetMap (gratuit, sans token) |
| **IA / NLP** | Mistral AI (mistral-small-latest, JSON mode) |
| **Auth** | Supabase Auth (email/password, cookies) |
| **Parsing fichiers** | PapaParse (CSV), SheetJS (XLSX), natif (GeoJSON) |
| **Géocodage** | API BAN data.gouv.fr (adresses FR, gratuit) + proj4 (Lambert 93 → WGS84) |
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
│   ├── map/page.tsx                       ← Carte interactive POI + recherche IA
│   ├── dashboard/page.tsx                 ← Dashboard utilisateur (auth)
│   ├── login/page.tsx                     ← Login / Sign-up email
│   ├── admin/
│   │   ├── import/page.tsx                ← Import Universel (CSV/XLSX/GeoJSON, 5 étapes)
│   │   ├── carreaux-import/page.tsx       ← Import Carreaux INSEE
│   │   ├── sources/page.tsx               ← Gestion des sources de données
│   │   ├── organizations/page.tsx         ← Gestion multi-tenant
│   │   └── health/page.tsx                ← Health Check système
│   ├── api/
│   │   ├── parse-prompt/route.ts          ← Mistral → JSON filtres panneaux
│   │   ├── search-panneaux/route.ts       ← Filtres → panneaux Supabase (RPC PostGIS)
│   │   ├── search-poi/route.ts            ← Recherche POI par catégorie
│   │   ├── ai/parse-poi-query/route.ts    ← Mistral → filtres POI (carte IA)
│   │   ├── auth/[...auth]/route.ts        ← Auth endpoints
│   │   ├── admin/
│   │   │   ├── import-poi/route.ts        ← SSE import POI en base
│   │   │   ├── import-carreaux/route.ts   ← Import carreaux INSEE
│   │   │   ├── sources/route.ts           ← CRUD sources
│   │   │   ├── organizations/route.ts     ← CRUD organisations
│   │   │   ├── health/route.ts            ← Health check API
│   │   │   ├── source-filters/route.ts    ← Filtres par source
│   │   │   ├── delete-source/route.ts     ← Suppression source
│   │   │   ├── delete-category/route.ts   ← Suppression catégorie
│   │   │   ├── verify-url/route.ts        ← Vérification URL
│   │   │   └── init-admin/route.ts        ← Init admin user
│   │   └── debug/poi-stats/route.ts       ← Stats POI debug
│   └── components/
│       ├── AISearchInput.tsx               ← Barre de recherche IA (robot pixel art animé)
│       ├── MapIntegrated.tsx               ← Carte intégrée (page d'accueil)
│       ├── MapIntegratedClient.tsx
│       ├── MaplibreMap.tsx                 ← Carte MapLibre
│       └── MaplibreMapClient.tsx
├── components/
│   ├── GenesisNav.tsx                     ← Sidebar navigation (affiche APP_VERSION)
│   └── map/
│       ├── MapContainer.tsx               ← Conteneur carte MapLibre + GeoJSON layers
│       ├── MapSidebar.tsx                 ← Sidebar résultats carte
│       ├── SearchBar.tsx                  ← Barre de recherche carte
│       └── hooks/
│           ├── useClusters.ts             ← Clustering Supercluster
│           ├── useMapPanels.ts            ← Gestion panneaux latéraux
│           └── useMapViewport.ts          ← Gestion viewport carte
├── lib/
│   ├── version.ts                         ← VERSION CENTRALE + changelog
│   ├── auth.ts                            ← Helpers auth serveur (createAdminClient)
│   ├── auth-client.ts                     ← Hooks auth client (useSession, useSignIn)
│   ├── supabase.ts                        ← Client Supabase partagé (HTTPS)
│   ├── geo-resolver.ts                    ← Résolution géo (dept, villes, régions → valeurs DB)
│   ├── map/
│   │   ├── config.ts                      ← Config carte (couleurs, viewport France)
│   │   ├── types.ts                       ← Types carte
│   │   └── utils.ts                       ← Utilitaires carte
│   ├── import/
│   │   ├── file-parser.ts                 ← Parse CSV/XLSX/GeoJSON
│   │   ├── column-detector.ts             ← Détection automatique des colonnes
│   │   ├── geocoder.ts                    ← Géocodage BAN (adresse → lat/lng)
│   │   ├── inserter.ts                    ← Insert Supabase JS client (HTTPS port 443)
│   │   ├── validator.ts                   ← Validation données avant import
│   │   └── types.ts                       ← Types import
│   ├── api/errors.ts                      ← Gestion erreurs API
│   └── db/migrations/                     ← Migrations SQL
├── middleware.ts                           ← Middleware Next.js (auth passthrough)
├── .env.local                             ← Clés API (jamais commité)
└── .env.example                           ← Template variables d'environnement
```

---

## 🔑 Variables d'environnement (.env.local)

```env
# Mistral AI (pour recherche IA)
MISTRAL_API_KEY=sk_...

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Auth
BETTER_AUTH_SECRET=your-secret-key-min-32-characters
BETTER_AUTH_URL=http://localhost:3000
```

> **Note v5.0** : `DATABASE_URL` et `SUPABASE_DB_URL` ne sont **plus nécessaires**.
> Tout passe par le client Supabase JS (HTTPS, port 443). Le firewall dentsu ne bloque plus rien.

Voir `.env.example` pour le template complet. Vérifier la config : **http://localhost:3000/admin/health**

---

## 🗄️ Base de données Supabase

### Tables

| Table | Description |
|-------|-------------|
| **poi_france** | Points d'intérêt (lycées, collèges, gares, CIRFA...) avec geom PostGIS |
| **panneaux_affichage** | Panneaux d'affichage publicitaire géolocalisés |
| **poi_metadata_index** | Index filtrable clé/valeur pour POI |
| **data_sources** | Sources de données importées (tracking, compteurs) |
| **organizations** | Organisations multi-tenant |
| **profiles** | Profils utilisateurs (role: super_admin / admin / client) |
| **enrichissement_jobs** | Traçabilité des jobs ETL |

### Fonctions PostGIS

| Fonction | Description |
|----------|-------------|
| `panneaux_near_point(lat, lng, rayon_m, limit)` | Panneaux dans un rayon autour d'un point GPS |
| `panneaux_near_poi(categorie, rayon_m, meta_cle, meta_valeur, limit)` | Panneaux proches d'un type de POI |
| `auto_set_geom` (trigger) | Génère automatiquement le champ `geom` PostGIS à l'insertion |

---

## 🎯 Fonctionnalités

### Parse Prompt IA (`/`)
Prompt en français → Mistral AI → filtres JSON → recherche panneaux Supabase → carte MapLibre.

### Carte Interactive POI (`/map`)
- Tous les POI par catégorie avec filtres dynamiques
- Recherche IA en langage naturel (barre avec robot pixel art animé)
- Clustering Supercluster pour hautes densités
- Filtres par source de données
- Popups détaillés au clic, sidebar résultats

### Import Universel (`/admin/import`)
Pipeline 5 étapes : Upload → Mapping auto → Géolocalisation (GPS/BAN/Lambert93) → Dry Run + aperçu carte → Import SSE temps réel.

### Import Carreaux INSEE (`/admin/carreaux-import`)
Import données carroyées INSEE pour enrichissement géographique.

### Back-Office
- **Sources** — CRUD, filtres, partage inter-organisations
- **Organisations** — Multi-tenant, gestion membres
- **Health Check** — Diagnostic Supabase, tables, stats
- **Auth** — Login/signup email, sessions cookies

---

## ⚠️ Règles de développement

### 1. Versioning (obligatoire)

**Fichier central** : `lib/version.ts`

```typescript
export const APP_VERSION = '5.0.0'; // ← TOUJOURS INCRÉMENTER
```

| Type | Version | Exemple |
|------|---------|---------|
| Refonte majeure / breaking | MAJOR | 5.0.0 → 6.0.0 |
| Nouvelle feature | MINOR | 5.0.0 → 5.1.0 |
| Bugfix / logs | PATCH | 5.0.0 → 5.0.1 |

Procédure : modifier le code → incrémenter `APP_VERSION` → ajouter entrée `CHANGELOG`.

### 2. Logs structurés

```typescript
// ✅ BON
console.log('[INSERTER] Start: 687 lignes, type="poi"');
console.error('[INSERTER] Erreur SQL ligne #42:', err.message);

// ❌ MAUVAIS
console.log('done');
```

| Module | Préfixe |
|--------|---------|
| Import | `[INSERTER]` |
| API Import | `[EXECUTE]` |
| Organizations | `[ORGS]` |
| Sources | `[SOURCES]` |
| Health | `[HEALTH]` |
| Auth | `[AUTH]` |
| Géocodage | `[GEO]` |

### 3. Règles générales

1. **Ne jamais committer les clés API** — `.env.local` est dans `.gitignore`
2. **ON CONFLICT DO NOTHING** sur tous les inserts
3. **Ne jamais supprimer de données** sans confirmation explicite
4. **Tout insert passe par le client Supabase JS** (HTTPS, pas de connexion PostgreSQL directe)
5. **Remonter les erreurs SQL au client** — logger + afficher dans l'UI

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
| `/map` | Carte interactive POI + recherche IA |
| `/dashboard` | Dashboard utilisateur |
| `/login` | Connexion / Inscription |
| `/admin/import` | Import Universel (CSV/XLSX/GeoJSON) |
| `/admin/carreaux-import` | Import Carreaux INSEE |
| `/admin/sources` | Gestion des sources de données |
| `/admin/organizations` | Gestion des organisations |
| `/admin/health` | Health Check système |

---

## 📝 Changelog

| Version | Date | Changements clés |
|---------|------|-------------------|
| **5.0.0** | 2026-02-24 | Inserter Supabase JS (HTTPS), suppression PostgreSQL direct, trigger auto_set_geom |
| **4.2.0** | 2026-02-24 | Mega-logs SSE temps réel, journal d'erreur live dans l'UI |
| **4.1.0** | 2026-02-24 | Renommage GEO.Prompt, Health Check page, versioning dynamique |
| **4.0.0** | 2026-02-23 | Back-office complet (Organizations, Sources, Auth), tracking data_source_id |
| **3.0.0** | 2026-02-20 | Import Universel 5 étapes, géocodage BAN, Carreaux INSEE |
| **2.0.0** | 2026-02-15 | Carte interactive, filtres POI + Panneaux |
| **1.0.0** | 2026-02-10 | Lancement initial, Parse Prompt IA, Supabase + PostGIS |

---

## 🐛 Problèmes connus & solutions

| Problème | Solution |
|----------|----------|
| `EPERM lstat LA_vsidol01` | Lancer PowerShell en tant que LA_vsidol01 |
| `npm : scripts désactivés` | `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force` |
| `next n'est pas reconnu` | Utiliser `npx next dev` |
| Port 3000 occupé | Next.js passe auto sur 3001 |
| `.env.local` pas chargé | Redémarrer le serveur Next.js |
| Firewall bloque PostgreSQL | Résolu en v5.0 — client Supabase JS (HTTPS port 443) |

---

*GEO.Prompt v5.0.0 — AI Media Planning Platform*
