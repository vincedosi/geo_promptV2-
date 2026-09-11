# CLAUDE.md — MAGELIAN

> Chaque ligne ici prévient une erreur réelle. Si tu l'ignores, l'app casse.

@ARCHITECTURE.md
@DESIGN_SYSTEM.md

## Projet

**MAGELIAN** — SaaS B2B géomarketing OOH/DOOH. Planification d'affichage extérieur sur données INSEE.
Stack : Next.js 15 App Router · TypeScript strict · Supabase Pro (PostgreSQL 15 + PostGIS, compute **Nano**) · MapLibre GL JS · Vercel AI SDK (Gemini 2.5 Flash / Mistral Small) · Tailwind CSS · Inngest · Zod · Vitest
Projet Supabase : `vkkdbygwbrxyogqosten` (eu-west-3). Utiliser MCP Supabase (`execute_sql`, `apply_migration`), JAMAIS de SQL manuel.

## ⛔ RÈGLES CRITIQUES — NON NÉGOCIABLE

### Supabase Nano — Disk I/O (250 IOPS, 5 MB/s, burst 30 min/jour)

**Budget I/O épuisé → Auth 504 → app down pendant des heures. Déjà arrivé 3 fois.**

INTERDIT :
- Batch/parallèle > 1 colonne sur tables IRIS (51k) ou carreaux_filosofi (2.3M)
- Bbox France entière sans LIMIT — bbox métro max : `-5.5,41.2,9.8,51.2`
- Prefetch/preload massif au chargement de page
- `Promise.all()` > 3 appels Supabase simultanés
- Full table scan sur tables volumineuses
- Endpoints acceptant des listes illimitées de colonnes

OBLIGATOIRE :
- Lazy loading : 1 colonne à la fois, à la demande
- Bbox = viewport carte visible, jamais France entière au 1er chargement
- Cache client `useRef` — vérifier AVANT tout fetch
- `EXPLAIN ANALYZE` sur toute nouvelle requête PostGIS
- Index GIST sur toute colonne géométrie

### Auth Middleware

```
Routes API (/api/*) → getSession()  — JWT local, ZÉRO appel réseau
Pages (/map, /dashboard…) → getUser() — un appel par navigation
```

IMPORTANT : `getUser()` sur routes API → 409 token refresh concurrent → déconnexion. Incident du 28/03.

### Fichiers protégés — NE PAS MODIFIER sauf demande explicite

`app/api/isochrone-battle/route.ts` · Fonctions PostGIS battle · `middleware.ts`

### Données clés

- Table `iris` — colonnes socio-démo **dynamiques**. JAMAIS hardcoder la liste de colonnes.
- `is_true_iris = true` → vrais IRIS (~16 400). Filtrer pour toute analyse statistique.
- `.trim()` obligatoire sur données CSV INSEE (espaces invisibles).
- POI importés : `id` **déterministe** (UUIDv5 du contenu de la ligne, `lib/import/identite-poi.ts`). JAMAIS de `randomUUID()` — c'est ce qui rendait `onConflict: 'id'` inopérant et dupliquait tout au rejeu d'un import (`ECH-001`).
- Gzip obligatoire sur réponses MVT. MapLibre 5.x plante silencieusement sans.
- `geom_3857` pré-calculé sur `carreaux_filosofi`. Ne pas recalculer à la volée.
- PMTiles IRIS → GitHub Releases (pas Supabase Storage). Proxy : `/api/iris-tiles-proxy`.

## Méthodologie

1. **Reconnaissance** — `grep -rn` sur les fichiers concernés AVANT de coder
2. **Impact I/O** — Le changement augmente la charge DB ? → alerter AVANT de coder
3. **Pas de modifs non demandées** — Ne pas refactorer/améliorer du code adjacent
4. **Code complet** — Copy-pasteable, jamais de `// ... rest of the code`
5. **Vérification** — Après modif, `grep` pour confirmer que rien d'autre n'est cassé
6. **Résumé structuré** — Fichiers modifiés, changements, ce qui n'a PAS changé

### Documentation — à jour DANS le commit, jamais après

`ARCHITECTURE.md` **à la racine** est la seule source de vérité. Un commit qui
ajoute ou retire une route, une table, une RPC, une variable d'environnement ou
une dépendance externe met le doc à jour **dans le même commit**. Pas de passe
de rangement plus tard : une doc périmée ne se contente pas d'être inutile, elle
ment avec autorité.

Constaté le 2026-09-11 : `docs/architecture.md` (30/04) affirmait
« 70 tables — RLS partout », ce qui se lit comme une garantie de sécurité alors
que les policies sont **dormantes**. Et il était le seul à documenter Modal, un
service Python tiers appelé par du code vivant. Un doc faux ET un doc à trou,
parce qu'on en maintenait deux.

- **Jamais deux documents d'architecture.** On n'en synchronise jamais deux.
- **Piège Windows** : `docs/architecture.md` et `docs/ARCHITECTURE.md` sont le
  MÊME fichier. Écrire l'un écrase l'autre en silence.
- `tests/unit/docs/derive-documentation.test.ts` garde les faits mesurables
  (variables d'env critiques, dépendances externes, dormance des RLS, unicité
  du doc). Il échoue si la doc dérive — ne pas le désactiver, le mettre à jour.

### Imports & batch DB — Progression OBLIGATOIRE

Tout import/traitement batch DOIT avoir : barre de progression UI (%, lignes traitées/total), logs temps réel (SSE/NDJSON), étapes nommées (parsing → insertion → post-traitement), compteurs finaux. JAMAIS de traitement DB silencieux.

## Conventions

- TypeScript strict, imports absolus `@/`, types dans `types/`
- Routes API : `export const dynamic = 'force-dynamic'`, validation Zod, `createAdminClient()` depuis `@/lib/auth`
- Outils IA : 1 fichier = 1 outil dans `lib/chat/tools/`, retourne données structurées (jamais texte libre)
- Inserts DB : batch par 50 max — **une seule requête par lot**, avec repli
  ligne à ligne en cas d'échec pour désigner la ligne fautive
  (patron `lib/import/inserter.ts`). Jusqu'au 2026-09-11 ce fichier faisait
  un aller-retour PAR LIGNE : la règle le citait en exemple alors qu'il ne
  la respectait pas.
- Tout `upsert(..., { ignoreDuplicates: true })` doit être suivi de
  `.select('id')`. `ON CONFLICT DO NOTHING` ne renvoie QUE les lignes
  réellement écrites : sans ce `select`, « inséré » et « déjà présent » sont
  indiscernables et le rapport d'import annonce des lignes qu'il n'a pas
  créées. Corollaire de l'identité déterministe des POI.
- Carto : MapLibre, fonds OpenFreeMap, MVT via `/api/tiles/[z]/[x]/[y]`
- Git : commits atomiques, format `type: description`
- Design : dark minimal, Inter + JetBrains Mono, accent teal #4ecdc4, pas de violet, sentence case, flat total

## Fichiers de référence (lire AVANT de créer)

| Type | Exemple à lire |
|------|---------------|
| Route API | `app/api/iris/stats/route.ts` |
| Outil IA | `lib/chat/tools/*.ts` |
| Composant carte | `app/map/_components/FilterPanel.tsx` |
| Import données | `lib/import/inserter.ts` |
| Import DSP | `app/api/admin/campaigns/import/route.ts` |
| Column mappings | `lib/dsp-mapping/loader.ts` (mappings dynamiques en base `dsp_source_mappings`) |
| Migration SQL | `sql/SETUP.md` |

## Commandes

```bash
npm run dev          # Dev (localhost:3000)
npm run build        # Build prod
npx tsc --noEmit     # Type-check
npm test             # Vitest
npm run lint         # ESLint
```

## Compaction

Quand tu fais `/compact`, préserve TOUJOURS :
- La liste exacte des fichiers modifiés dans cette session
- Le statut des tests (pass/fail + erreurs)
- Les contraintes I/O Supabase Nano (section ⛔ ci-dessus)
- Le contexte de la tâche en cours

## Incidents — NE PAS REPRODUIRE

| Date | Cause | Impact |
|------|-------|--------|
| 03-28 | Prefetch 24 colonnes IRIS × bbox France | I/O épuisé → 504 → down heures |
| 03-28 | `getUser()` sur routes API × 15 req parallèles | 409 refresh → déconnexion |
| 04-08 | 3 COUNT séquentiels × N campagnes (280k rows) | Timeout + boucle infinie client |
| 04-08 | `request.formData()` dans `ReadableStream.start()` | Import SSE cassé (body consumed) |
| 04-08 | Matching IRIS 266k lignes (DISTINCT ON + 3 JOINs) | I/O épuisé → DB down ~5 min |
