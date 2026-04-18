# GEOMATIK — Geospatial Intelligence

> **Version** : 7.5.0 — Avril 2026
> **Repo** : [vincedosi/geo_promptV2-](https://github.com/vincedosi/geo_promptV2-)

Plateforme SaaS B2B de géomarketing pour planneurs média outdoor (OOH).
L'utilisateur tape un prompt en français → l'IA extrait des filtres structurés → recherche géospatiale dans Supabase → affichage carte interactive.

> **Nouveau dev ?** Commence par lire **[ARCHITECTURE.md](./ARCHITECTURE.md)** puis **[CLAUDE.md](./CLAUDE.md)** (contraintes critiques pour Claude Code).

---

## Stack technique

| Couche | Technologie |
|--------|-------------|
| **Framework** | Next.js 14 (App Router, TypeScript strict, Tailwind CSS) |
| **Base de données** | Supabase (PostgreSQL 15 + PostGIS) |
| **Cartographie** | MapLibre GL JS 5 + OpenFreeMap + style dark GEOMATIK |
| **IA / NLP** | Multi-provider via Vercel AI SDK v6 : Gemini 2.5 Flash (défaut), Mistral Small |
| **Parsing fichiers** | PapaParse (CSV), SheetJS (XLSX), hyparquet (Parquet), shpjs (Shapefile) |
| **Géocodage** | API BAN data.gouv.fr (adresses FR, gratuit) + proj4 (Lambert 93 ↔ WGS84) |
| **Isochrones** | OpenRouteService API — batch 5 POIs/appel |
| **Tuiles vectorielles** | ST_AsMVT PostGIS + PMTiles (GitHub Releases) |
| **Validation** | Zod |
| **Jobs asynchrones** | Inngest |
| **UI** | Design system GEOMATIK — dark minimal (Inter + JetBrains Mono) |
| **Sécurité** | RLS Supabase, requireAdmin(), adminFetch(), Zod input validation, SSRF whitelist |

---

## Fonctionnalités principales

### Copilote Media IA (`/copilote`)

Chat conversationnel IA + carte interactive split screen. 10 outils IA modulaires (function calling). Multi-provider Gemini/Mistral. MCP data.gouv.fr (opt-in). Rate limit 12 req/min/IP.

### Carte interactive (`/map`)

POI par catégorie, carreaux INSEE choroplèthe, Voronoï géométrique, bataille d'isochrones, couverture audience Filosofi, zones IRIS.

### Zones IRIS

Table `iris` (~51k zones), colonnes socio-démo dynamiques, crawler INSEE intégré (5 routes), tuiles MVT + PMTiles.

### Data Lake OOH

Table `global_ooh`, import ArcGIS REST streaming, scoring paramétrique, rapport Excel.

### Import universel

Pipeline 5 étapes (upload → mapping auto → géolocalisation → dry run → import SSE). Support CSV/XLSX/GeoJSON/Shapefile/Parquet.

---

## Démarrage

```powershell
cd C:\GENESIS\genesis_app
npm install
npx next dev
# http://localhost:3000 (redirige vers /copilote)
```

### Pages disponibles

| URL | Description |
|-----|-------------|
| `/copilote` | Copilote Media IA (chat + carte split screen) |
| `/map` | Carte POI + carreaux + Voronoï + bataille |
| `/dashboard` | Tableau de bord + crawler IRIS |
| `/admin/ooh-import` | Import OOH ArcGIS REST |
| `/admin/import` | Import universel |
| `/admin/imports` | Historique imports |
| `/admin/carreaux-import` | Import carreaux INSEE |
| `/admin/filosofi-import` | Import Filosofi |
| `/admin/sources` | Gestion sources de données |
| `/admin/organizations` | Gestion organisations |
| `/admin/profiles` | Gestion profils |
| `/admin/health` | Health check système |

---

## Variables d'environnement (.env.local)

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_DB_URL=postgresql://...

# IA
GOOGLE_GENERATIVE_AI_API_KEY=...
MISTRAL_API_KEY=...

# Isochrones
ORS_API_KEY=...

# Admin
ADMIN_INIT_KEY=...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## Documentation

| Fichier | Contenu |
|---------|---------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Stack, arborescence, routes API, tables, RPCs, env vars |
| [CLAUDE.md](./CLAUDE.md) | Contraintes critiques, méthodologie, incidents |
| [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) | Tokens couleur, typographie, composants UI |

---

## Problèmes connus

| Problème | Solution |
|----------|----------|
| `EPERM lstat LA_vsidol01` | Lancer PowerShell en tant que LA_vsidol01 |
| `.env.local` pas chargé | Redémarrer le serveur Next.js |
| Bataille timeout (>280s) | Lancer d'abord depuis `/map` pour remplir le cache ORS |
| Routes admin 403 | Vérifier `SUPABASE_SERVICE_ROLE_KEY` dans `.env.local` |
| Gemini rate limit 429 | Switcher sur Mistral |
| Supabase 504 I/O | Budget Nano épuisé — attendre le reset ou éviter les full scans |

---

*GEOMATIK v7.5.0 — Geospatial Intelligence*
