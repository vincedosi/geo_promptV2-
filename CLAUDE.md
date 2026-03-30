# CLAUDE.md — GENESIS

> Lu automatiquement à chaque session. Chaque ligne ici prévient une erreur réelle.

@ARCHITECTURE.md

## Projet

**GENESIS** — SaaS B2B géomarketing OOH. Planification d'affichage extérieur sur données INSEE.
Stack : Next.js 14 App Router · TypeScript strict · Supabase Pro (PostgreSQL 15 + PostGIS, compute **Nano**) · MapLibre GL JS · Vercel AI SDK (Gemini 2.5 Flash / Mistral Small) · Tailwind CSS · Inngest · Zod · Vitest

### Vocabulaire métier
- **OOH** = affichage publicitaire extérieur (panneaux, abribus, DOOH)
- **IRIS** = découpage INSEE ~2000 hab (~51k zones France) — table `iris_data`
- **Carreaux Filosofi** = grille INSEE 200m × 200m, indicateurs socio-démo — table `carreaux_filosofi` (~2.3M lignes)
- **Isochrone** = zone accessible en N min (pied/vélo/voiture) via OpenRouteService
- **Battle** = découpage territorial sans chevauchement (Voronoï pondéré par isochrones)
- **Choroplèthe** = carte colorée par gradient selon un indicateur statistique
- **Scoring OOH** = note composite d'un panneau (audience × démographie × trafic × proximité POI)

## ⛔ RÈGLES CRITIQUES

### Supabase Nano — Disk I/O (250 IOPS, 5 MB/s, burst 30 min/jour)

**Si le budget I/O est épuisé → Auth 504 → app inaccessible pendant des heures.**

INTERDIT :
- Batch/parallèle de plus de 1 colonne sur les tables IRIS ou carreaux
- Bbox France entière + DOM-TOM (`-63.2,-21.5,55.9,51.2`) sans LIMIT — bbox métro max : `-5.5,41.2,9.8,51.2`
- Prefetch/preload massif au chargement de page
- `Promise.all()` avec plus de 3 appels Supabase
- Full table scan sur iris_data (51k) ou carreaux_filosofi (2.3M)
- Endpoints avec listes illimitées de colonnes (`?colonnes=X,Y,Z` est INTERDIT)

OBLIGATOIRE :
- Lazy loading : 1 colonne/ressource à la fois, à la demande
- Bbox = viewport visible de la carte, jamais France entière au premier chargement
- Cache client `useRef` — vérifier AVANT tout fetch
- Concurrence API ≤ 3 simultanés
- `EXPLAIN ANALYZE` sur toute nouvelle requête PostGIS
- Index GIST sur toute colonne géométrie

### Middleware Auth

```
Routes API (/api/*) → getSession()  — JWT local, ZÉRO appel réseau
Pages (/map, /dashboard…) → getUser() — un appel par navigation
```

NE JAMAIS remettre `getUser()` sur les routes API → cause 409 token refresh concurrent → déconnexion.

### Fichiers protégés — NE PAS MODIFIER sauf demande explicite

- `app/api/isochrone-battle/route.ts`
- Fonctions PostGIS battle (`get_isochrone_battle`, `clip_geojson_to_france`)
- `middleware.ts`

## Méthodologie

1. **Reconnaissance** — `grep -rn` sur les fichiers concernés AVANT de coder
2. **Impact I/O** — Évaluer si le changement augmente la charge DB. Si oui → alerter
3. **Pas de modifs non demandées** — Ne pas refactorer/améliorer du code adjacent
4. **Code complet** — Copy-pasteable, jamais de `// ... rest of the code`
5. **Vérification grep** — Après modif, confirmer que rien d'autre n'est cassé
6. **Résumé structuré** — Fichiers modifiés, ce qui a changé, ce qui n'a pas changé

## Conventions

- TypeScript strict, imports absolus `@/`, types dans `types/`
- Routes API : `export const dynamic = 'force-dynamic'`, validation Zod, `createAdminClient()` depuis `@/lib/auth`
- Outils IA : 1 fichier = 1 outil dans `lib/chat/tools/`, retourne données structurées (jamais texte libre)
- Inserts DB : batch par 50 max (pattern `lib/import/inserter.ts`)
- Carto : MapLibre, fonds OpenFreeMap, MVT via `/api/tiles/[z]/[x]/[y]`, PMTiles IRIS depuis `/public`

## Design System
Pour TOUT travail frontend (composant, page, fix visuel), lis et applique les règles de DESIGN_SYSTEM.md AVANT de commencer. Ce fichier est la source de vérité pour les couleurs, typographies, composants et patterns UI.

## Fichiers de référence (lire avant de créer)

- Nouvelle route API → `app/api/iris/stats/route.ts`
- Nouvel outil IA → n'importe quel fichier dans `lib/chat/tools/`
- Nouveau composant carte → `app/map/_components/FilterPanel.tsx`
- Import de données → `lib/import/inserter.ts`
- Migration SQL → `sql/SETUP.md`

## Commandes

```bash
npm run dev          # Dev (localhost:3000)
npm run build        # Build prod
npx tsc --noEmit     # Type-check
npm test             # Vitest
npm run lint         # ESLint
```

## Compaction

Quand tu fais `/compact`, préserve : la liste des fichiers modifiés, le statut des tests, et les contraintes I/O Supabase Nano.

## Incidents — NE PAS REPRODUIRE

| Date | Cause | Conséquence |
|------|-------|-------------|
| 2026-03-28 | Prefetch batch 24 colonnes IRIS × bbox France entière | Disk I/O Nano épuisé → Supabase 504 → app down plusieurs heures |
| 2026-03-28 | `getUser()` middleware sur routes API × 15 requêtes parallèles | 409 token refresh → déconnexion utilisateur |
