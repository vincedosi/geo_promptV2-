# GEO.Prompt — AI Media Planning Platform

> **Version** : 5.6.0 — 26 février 2026
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
| **Cartographie** | MapLibre GL JS + CARTO Light raster tiles (gratuit, sans token) |
| **IA / NLP** | Mistral AI (mistral-small-latest, JSON mode, function calling) |
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
│   ├── map/page.tsx                       ← Carte POI + carreaux choroplèthe + recherche IA
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
│   │   ├── carreaux/route.ts              ← GET: sources carreaux / POST: GeoJSON FeatureCollection
│   │   ├── chat/route.ts                  ← Copilote IA (Mistral function calling, boucle agentique)
│   │   ├── ai/parse-poi-query/route.ts    ← Mistral → filtres POI (carte IA)
│   │   ├── auth/[...auth]/route.ts        ← Auth endpoints
│   │   ├── admin/
│   │   │   ├── import-poi/execute/route.ts ← SSE import POI en base
│   │   │   ├── import-carreaux/route.ts   ← Import carreaux INSEE (Python subprocess)
│   │   │   ├── sources/route.ts           ← CRUD sources
│   │   │   ├── sources/[id]/route.ts      ← GET/PATCH/DELETE source
│   │   │   ├── sources/[id]/meta-keys/route.ts ← Clés metadata d'une source
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
│       ├── MaplibreMap.tsx                 ← Carte MapLibre (legacy)
│       └── MaplibreMapClient.tsx
├── app/
│   ├── error.tsx                          ← Error boundary (erreurs runtime)
│   ├── global-error.tsx                   ← Error boundary global
│   └── not-found.tsx                      ← Page 404 custom
├── components/
│   ├── GenesisNav.tsx                     ← Sidebar navigation (affiche APP_VERSION)
│   └── map/
│       ├── MapContainer.tsx               ← Carte MapLibre + markers DOM + carreaux choroplèthe
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
│   ├── poi/categories.ts                  ← Catégories POI (couleurs, labels)
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
```
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
| **data_sources** | Sources de données importées (type: poi / carreaux, tracking) |
| **`<carreaux_table>`** | Tables dynamiques (ex: `carroyage_insee_metro_s2`) — idcar + geom + metadata JSONB |
| **organizations** | Organisations multi-tenant |
| **profiles** | Profils utilisateurs (role: super_admin / admin / client) |
| **enrichissement_jobs** | Traçabilité des jobs ETL |

### Fonctions PostGIS

| Fonction | Description |
|----------|-------------|
| `panneaux_near_point(lat, lng, rayon_m, limit)` | Panneaux dans un rayon autour d'un point GPS |
| `panneaux_near_poi(categorie, rayon_m, meta_cle, meta_valeur, limit)` | Panneaux proches d'un type de POI |
| `create_carreaux_table(table_name)` | Crée une table carreaux dynamique (idcar + geom + metadata) |
| `drop_carreaux_table(table_name)` | Supprime une table carreaux + entrée data_sources |
| `auto_set_geom` (trigger) | Génère automatiquement le champ `geom` PostGIS à l'insertion |

---

## 🎯 Fonctionnalités

### Parse Prompt IA (`/`)
Prompt en français → Mistral AI → filtres JSON → recherche panneaux Supabase → carte MapLibre.

### Carte Interactive POI (`/map`)
- Tous les POI par catégorie avec filtres dynamiques (toutes catégories cochées par défaut)
- **Markers DOM** (plus de GeoJSON layers — fonctionne sans attendre le chargement du style)
- **Couche carreaux INSEE** — choroplèthe polygon (fill + outline, palette 5 niveaux bleu)
  - Sélecteur de source carreaux (dropdown)
  - **Sélecteur de métrique dynamique** : la liste des indicateurs disponibles (champs numériques) est détectée automatiquement à partir des données de la source sélectionnée. Le dropdown se met à jour dynamiquement, et le premier champ numérique trouvé est sélectionné par défaut.
  - **Auto-localisation** : lors du changement de source, la carte se centre automatiquement sur la zone où se trouvent les données.
  - **Robustesse** : gestion des erreurs côté API (fonction SQL manquante, absence de données dans le viewport, etc.) avec messages explicites dans l'UI.
  - **Palette choroplèthe** : recalcul automatique du dégradé de couleurs à chaque changement d'indicateur.
  - Légende dégradé min→max
  - Filtres catégoriels pour les champs texte des carreaux
  - Auto-zoom sur le bounding box des carreaux au premier chargement
  - Popup adaptative au clic (affiche les vrais champs du carreau)
- Recherche IA en langage naturel (barre avec robot pixel art animé)
- **Filtres auto-découverts** depuis les données : colonnes directes (région, département, sous-catégorie) + champs metadata (2–50 valeurs distinctes)
- Matching IA normalisé (accents, noms partiels)
- Tuiles raster CARTO Light (pas besoin de glyphs/sprites)
- Status bar : coordonnées valides, compteur filtres actifs, taille échantillon
- Bouton "Effacer filtres" + reset auto au changement de catégories
- Popups détaillés au clic (adresse, ville, département, catégorie)
- Export Excel des POIs affichés

### Import Universel (`/admin/import`)
Pipeline 5 étapes : Upload → Mapping auto → Géolocalisation (GPS/BAN/Lambert93) → Dry Run + aperçu carte → Import SSE temps réel.
- **Sélection de colonnes** : tableau avec checkbox "Importer" et "Filtre" par colonne
- Colonnes schema/géoloc verrouillées (toujours importées)
- `importedColumns` transmis au validator — seules les colonnes cochées vont en metadata
- `filterFields` exposés comme filtres carte
- Boutons "Tout importer" / "Tout exclure" / "Effacer filtres"

### Import Carreaux INSEE (`/admin/carreaux-import`)
Import données carroyées INSEE pour enrichissement géographique.
  - Upload CSV/GeoJSON depuis l'interface web
  - **Formats supportés** :
    - CSV avec `idcar_200m` (format CRS3035RES200mN…E… / CRS5490RES200mN…E…)
    - CSV avec colonnes `X, Y` en hectomètres (carroyage simplifié type `-s2`)
    - GeoJSON avec géométrie pré-calculée
  - Auto-détection du format (xy_hm vs idcar)
  - Conversion hectomètres → mètres EPSG:3035 → polygone 200m × 200m → WGS84
  - Création dynamique de la table Supabase via RPC `create_carreaux_table`
  - Insert par batch (upsert, 100 lignes/batch) avec retry cache PostgREST
  - Script Python : `genesis_etl/scripts/carreaux_import.py`
  - **Découverte automatique des indicateurs** : lors de l'import, les champs numériques sont détectés et exposés automatiquement dans l'interface carte pour le sélecteur de métrique.

### Copilote Media IA (`/copilote`)
Chat conversationnel IA + carte interactive en split screen.
- Mistral AI function calling (outil `analyser_zone_pois`)
- Connexion réelle aux données POI Supabase (bounding box)
- Markers colorés par catégorie, cercles de rayon par POI
- Bouton toggle **Carreaux** — choroplèthe auto (première métrique numérique)
- ZoneCard résultats, légende carte dynamique
- Prompt suggestions (lycées, scolaire, CIRFA)

### Back-Office
- **Sources** — CRUD, filtres, partage inter-organisations, **éditeur de filtres dynamique** (colonnes schema + clés metadata réelles via API `meta-keys`), boutons Tout cocher / Effacer, compteur
- **Organisations** — Multi-tenant, gestion membres
- **Health Check** — Diagnostic Supabase, tables, stats
- **Auth** — Login/signup email, sessions cookies
- **Error pages** — `error.tsx`, `global-error.tsx`, `not-found.tsx` (error boundaries Next.js)

---

## ⚠️ Règles de développement

### 1. Versioning (obligatoire)

**Fichier central** : `lib/version.ts`

```typescript
export const APP_VERSION = '5.6.0'; // ← TOUJOURS INCRÉMENTER
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
| Carte | `[MapContainer]` |
| Page carte | `[MapPage]` |
| Carreaux API | `[carreaux]` |
| Copilote IA | `[Copilote]` |

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
| `/map` | Carte interactive POI + carreaux choroplèthe + recherche IA |
| `/copilote` | Copilote Media IA (chat + carte split screen) |
| `/dashboard` | Dashboard utilisateur |
| `/login` | Connexion / Inscription |
| `/admin/import` | Import Universel (CSV/XLSX/GeoJSON) |
| `/admin/carreaux-import` | Import Carreaux INSEE (CSV/GeoJSON) |
| `/admin/sources` | Gestion des sources de données |
| `/admin/organizations` | Gestion des organisations |
| `/admin/health` | Health Check système |

---

## 📝 Changelog

| Version | Date | Changements clés |
|---------|------|-------------------|
| **5.6.0** | 2026-02-26 | Carte: carreaux choroplèthe, sélecteur métrique, auto-zoom bbox, popup adaptative, toggle Copilote, ETL X/Y hectomètres |
| **5.5.0** | 2026-02-26 | IA: filtres metadata (libelle_nature, hebergement), correspondances LP/LG/LGT/SEP |
| **5.4.3** | 2026-02-26 | Fix cercles POI: remove+recreate source/layers, opacity/width tuning |
| **5.4.0** | 2026-02-26 | Copilote IA: cercles individuels rayon_poi_metres, légende, ZoneCard badge |
| **5.3.0** | 2026-02-26 | Copilote IA: layout fullscreen chat+carte, Mistral function calling, markers POI |
| **5.2.0** | 2026-02-25 | IA multi-villes/régions/dept, filtres OR, export Excel, robot pixel art |
| **5.1.1** | 2026-02-25 | Sources: éditeur filtres dynamique (meta-keys API), boutons Tout cocher/Effacer |
| **5.1.0** | 2026-02-25 | Import: sélection colonnes (checkbox Importer/Filtre), importedColumns dans validator |
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
| Carreaux invisibles (blanc) | Métrique inexistante → auto-sélection v5.6.0 du 1er champ numérique |
| Carreaux non rendus | `mapReady` useState fix v5.6.0 (était ref, pas state → effects ignorés) |

---

## 🔧 ETL — genesis_etl

Pipeline ETL Python pour l'import de données géographiques dans Supabase.

```
genesis_etl/
├── scripts/
│   └── carreaux_import.py    ← Import carreaux INSEE (CLI + appelé par Next.js)
├── data/raw/                  ← Fichiers uploadés (CSV, GeoJSON, XLSX)
├── logs/                      ← Logs d'import
├── .env                       ← Clés Supabase (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
└── requirements.txt           ← Dépendances Python
```

### Carreaux Import — Formats supportés

| Format | Colonne clé | Exemple | CRS source |
|--------|-------------|---------|------------|
| **idcar classique** | `idcar_200m` | `CRS3035RES200mN2619600E3756800` | EPSG:3035 / EPSG:5490 |
| **X,Y hectomètres** | `X`, `Y` | `37568, 26196` (×100 → mètres) | EPSG:3035 |
| **GeoJSON** | géométrie incluse | FeatureCollection | tout CRS (reprojection auto) |

```powershell
# Test dry-run
python scripts/carreaux_import.py --csv-path data/raw/mon_fichier.csv --dry-run --limit 10

# Import réel
python scripts/carreaux_import.py --csv-path data/raw/mon_fichier.csv

# Table personnalisée
python scripts/carreaux_import.py --csv-path data/raw/mon_fichier.csv --table mon_nom_table
```

---

*GEO.Prompt v5.6.0 — AI Media Planning Platform*
