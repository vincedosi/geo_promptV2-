# Audit GEOMATIK — PASSE 1 : Inventaire dette technique

**Date** : 2026-04-25
**Branche** : `feat/analyse-v2`
**Méthode** : 4 agents parallèles (lecture seule, aucune modification)
**Périmètre** : `app/`, `components/`, `lib/`, `types/`, `hooks/`, `utils/`, `scripts/`, `.env.example`

---

## Synthèse exécutive

| Catégorie | Volume | Sévérité |
|-----------|--------|----------|
| Fichiers morts | **1 candidat** (`lib/stores/useLayerStore.ts`) | 🟢 Mineur |
| Imports inutilisés | **0** détecté sur 30 fichiers audités | 🟢 Sain |
| Console.* total | **248** (170 🟢 / 60 🟡 / 18 🔴) | 🟡 Modéré |
| TODO/FIXME/HACK | **10** (tous tracés roadmap) | 🟢 Mineur |
| Types `any` | **101** (42 fixable / 0 catch / 35 vendor / 24 JSONB) | 🟡 Modéré |
| Incohérences auth | **0** (`getUser` API : 0, `getSession` page : 0) | 🟢 Conforme |
| Routes admin sans `requireAdmin()` | **0** (sauf `init-admin` justifié) | 🟢 Conforme |
| Env vars manquantes `.env.example` | **0** | 🟢 Sain |
| Code dupliqué | **2 doublons** (`getOrgSourceIds`, `fetchAllPages`) | 🟡 Modéré |

**Score de santé global** : 🟢 **Codebase saine**, dette technique localisée et adressable. Aucun problème critique de sécurité ou d'architecture détecté. Les zones de cleanup sont identifiées et de faible risque.

---

## 1. Fichiers morts

### Candidat certain
| Fichier | Description | Action |
|---------|-------------|--------|
| `lib/stores/useLayerStore.ts` | Store Zustand de gestion d'état des couches carto (terrain, socio, media, analysis). Défini mais zéro importation. | **Supprimer** (PASSE 4) |

### Faux positifs (vérifiés actifs)
- `lib/chat/tools/*.ts` (15 fichiers) → importés via `lib/chat/tools/index.ts` (dispatcher dynamique sur nom d'outil)
- `lib/radio/anfr-parser.ts`, `arcom-ods-parser.ts`, `radio-matcher.ts` → utilisés dans `/api/radio/*`
- `lib/smart-prompt/router-prompt.ts`, `agents/demographie.ts`, `agents/poi-clustering.ts` → via orchestrator
- `lib/import/geo-enricher.ts` → via `lib/import/inserter.ts`

---

## 2. Imports inutilisés

**0 import inutilisé détecté** sur 30+ fichiers audités (zones chaudes : `app/api/admin`, `app/api/digital`, `app/map/_components`, `lib/chat/tools`, `lib/import`, `components/`).

→ Bonne hygiène TypeScript. Le linter et le tsc semblent strict. **Aucune action requise**.

---

## 3. Console.* (logging)

**Total : 248 occurrences** (151 dans `app/api/`, 97 dans `lib/` + `components/`)

### Catégorisation
| Type | Volume | Exemples | Action |
|------|--------|----------|--------|
| 🟢 Logging structuré (timers + tags) | ~170 | `[CHAT] pre-LLM: {duration}ms`, `[coverage-stats] Cache: {hits}/{total}`, `[isochrone] Cache HIT: {key}` | **Conserver** |
| 🟡 Catch errors | ~60 | `console.error('[api/carreaux POST] rpc error:', error.message)` | **Conserver mais formaliser** via `lib/logger.ts` (à créer) |
| 🔴 Debug oublié | ~18 | `[DIAG]` dans `app/api/iris-crawler/upload/route.ts:55-87` (10 occurrences) | **Supprimer** (PASSE 4) |

### Cibles 🔴 prioritaires
- `app/api/iris-crawler/upload/route.ts:55-87` — 10× `[DIAG]` colonnes CSV
- Ailleurs : ~8 `console.log` debug isolés dans `carreaux/dynamic`, divers

---

## 4. TODO / FIXME / HACK / XXX

**Total : 10 commentaires** — tous tracés à des features/tasks planifiées (aucun orphelin).

| Fichier | Ligne | Catégorie | Texte |
|---------|-------|-----------|-------|
| `app/globals.css` | 400 | Backlog | `TODO phase 2: light-mode hover` |
| `app/map/_components/CaptureLayers.tsx` | 15, 45, 158 | Voronoi V2 | `TODO V2 routier` (×3) |
| `app/api/custom-geo/source/voronoi/route.ts` | 4 | Voronoi V2 | `TODO V2 : mode routier (cache_keys 30/60/90/120)` |
| `lib/inngest/functions/calculateCoverageJob.ts` | 80 | Data-gated | `TODO: réactiver une fois ind/ind_18_24 remplis` |
| `components/map/overlays/AnalysesOverlay.tsx` | 8 | Task 4.5 | `typer les props depuis FilterPanelProps` |
| `components/map/overlays/PerimeterOverlay.tsx` | 7 | Task 4.3 | idem |
| `components/map/overlays/TerrainOverlay.tsx` | 7 | Task 4.4 | `typer les ~35 props` |
| `components/map/overlays/CampaignsOverlay.tsx` | 7 | Task 4.6 | `typer les props digital` |

→ **Aucune action immédiate**. Ces TODOs sont des features planifiées, pas de la dette à nettoyer.

---

## 5. Types `any`

**Total : 101 occurrences** (~0.67% du code TS) → niveau acceptable.

### Répartition
| Catégorie | Volume | Action |
|-----------|--------|--------|
| **A. Fixable** (signatures typables) | 42 | Corriger en PASSE 4 (top 30) |
| **B. `catch (e: any)`** | 0 | Bonne pratique déjà respectée |
| **C. Vendor / API externe** (MapLibre events, Gemini, MCP, ZSTD) | 35 | Documenter via JSDoc, garder |
| **D. JSONB Supabase** (config, profil scoring, metadata) | 24 | Documenter structure attendue |

### Top fixables (catégorie A)
- `lib/auth.ts:79` — `(profile as any).organizations?.name` → typer via join Supabase
- `app/copilote/_hooks/useToolProcessor.ts:61, 106-135, 150` — POI / Gemini tool result
- `app/admin/filosofi-import/page.tsx:55, 78, 268-269` — ShapeFile/Parquet metadata
- `app/map/page.tsx:547, 627` — `matchExpr: any[]` MapLibre expressions
- `lib/mcp/datagouv.ts:74, 166, 179, 193-194` — MCP SSE / tools/list

### Recommandation
- Créer `types/maplibre-expressions.ts` pour les match expressions
- Créer interfaces POI / GeoJSON Feature partagées
- Ajouter validation runtime Zod/io-ts sur retours RPC Supabase critiques

---

## 6. Incohérences auth (CRITIQUE — règle CLAUDE.md)

### Règle GEOMATIK
- **Routes API** (`/api/**/route.ts`) → `getSession()` (JWT local, zéro réseau)
- **Pages** (`/**/page.tsx`, `/**/layout.tsx`) → `getUser()` (validation + refresh)
- ⚠️ Incident 2026-03-28 : `getUser()` dans routes API → 409 token refresh → déconnexion

### Résultats
| Vérification | Résultat |
|--------------|----------|
| `getUser()` dans routes API | 🟢 **0 cas** |
| `getSession()` dans pages | 🟢 **0 cas** |
| `/api/admin/*` sans `requireAdmin()` (52 fichiers) | 🟢 **51/51 protégées** + `init-admin` justifié (header `x-admin-key`) |
| `/api/digital/*` sans `requireAuth()` (7 fichiers) | 🟢 **7/7 protégées** |
| `/api/radio/*` sans `requireAuth()` (7 fichiers) | 🟢 **7/7 protégées** (middleware + adminClient) |
| `/api/user/*` sans `getUserFromRequest()` | 🟢 Conforme |

### Conclusion
✅ **Architecture auth conforme et sécurisée**. Le middleware (`middleware.ts:68-129`) implémente correctement la séparation. **Aucune action sécurité requise** sur l'auth.

---

## 7. Variables d'environnement

### Vars référencées (17 total)

**Côté serveur (privées)** :
`SUPABASE_SERVICE_ROLE_KEY` (11), `SUPABASE_DB_URL` (5), `DATABASE_URL` (2), `POSTGRES_URL` (1), `SUPABASE_ANON_KEY` (2), `ORS_API_KEY` (4), `MISTRAL_API_KEY` (6), `GOOGLE_GENERATIVE_AI_API_KEY` (4), `UPSTASH_REDIS_REST_URL` (1), `UPSTASH_REDIS_REST_TOKEN` (1), `ADMIN_INIT_KEY` (2), `GITHUB_ACTIONS_TOKEN` (2), `GITHUB_REPO` (1), `GITHUB_TOKEN` (1)

**Côté client (NEXT_PUBLIC_*)** :
`NEXT_PUBLIC_SUPABASE_URL` (9), `NEXT_PUBLIC_SUPABASE_ANON_KEY` (7), `NEXT_PUBLIC_APP_URL` (3), `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (2), `NODE_ENV` (4)

### Vérifications
| Vérification | Résultat |
|--------------|----------|
| Vars manquantes dans `.env.example` | 🟢 **Aucune** |
| Vars `.env.example` inutilisées | 🟢 **Aucune** |
| Secrets non-`NEXT_PUBLIC_*` côté client | 🟢 **Aucun leak** |
| `NEXT_PUBLIC_*` exposant un secret | 🟢 **Aucune** (URLs publiques + clés JWT limitées) |

✅ **Configuration env vars exemplaire**.

---

## 8. Code dupliqué

### Doublon 1 : `getOrgSourceIds()` (RLS multi-tenant — risque dérive)
- `lib/auth/getOrgSourceIds.ts:12-26` (helper centralisé, crée son client)
- `app/api/map/pois/route.ts:26-40` (dupliqué localement, prend `supabase` en param)
- **Niveau** : quasi-identique
- **Action** : remplacer la version locale par un import du helper

### Doublon 2 : `fetchAllPages()` (pagination Supabase + retry cold-start)
- `lib/chat/tools/analyserZone.ts:81-118`
- `app/api/map/pois/route.ts:90-128`
- **Niveau** : quasi-identique (même retry, même timeout 20s, même stratégie 3 tentatives)
- **Action** : extraire dans `lib/api/paginate-supabase.ts`

### Patterns NON dupliqués (légitimes)
- `.eq('organization_id', orgId)` — filtre RLS standard
- Zod `safeParse` — pattern API standard
- Error handling Supabase `const { data, error } = …` — pattern SDK standard
- Response shapes — différences légitimes par métier

---

## 9. Plan PASSE 2 → 5

### PASSE 2 — Sécurité (audit + fixes)
**Audit additionnel à mener** :
- Secrets hardcodés (grep `sk-`, `eyJ`, UUID patterns, clés API)
- Injection SQL : template literals SQL avec params utilisateur (RPCs côté route.ts)
- XSS : `dangerouslySetInnerHTML` ou insertion HTML non sanitizé
- CORS : routes API renvoyant `Access-Control-Allow-Origin: *`
- SSRF : `fetch()` sur URL client sans whitelist (whitelist proposée : arcom.fr, insee.fr, datagouv, github.com, openrouteservice.org)
- Rate limiting : routes coûteuses (imports CSV, IA, isochrones) sans throttling
- IDOR : validation manquante sur `organization_id`/`user_id` du body POST/PUT

**Fixes attendus** : 0 ou très peu (auth déjà conforme).

### PASSE 3 — Performance
- Barrel exports massifs (`lib/index.ts`, `components/index.ts`)
- Imports librairies entières (lodash, etc.)
- `<img>` sans `next/image`
- Composants lourds sans `dynamic()` (MapLibre, charts, modals)
- `useMemo`/`useCallback` manquants (re-renders carte)
- Fetch waterfalls vs `Promise.all`
- Singleton `createBrowserClient` Supabase

### PASSE 4 — Nettoyage code
1. Supprimer `lib/stores/useLayerStore.ts`
2. Supprimer 18 `console.log` 🔴 (priorité `iris-crawler/upload`)
3. Corriger top 30 `any` catégorie A (POI, GeoJSON, MapLibre expressions)
4. Extraire `getOrgSourceIds()` dupliqué
5. Extraire `fetchAllPages()` → `lib/api/paginate-supabase.ts`
6. Vérifier les TODOs résolus (peu probable)

### PASSE 5 — Rapport final
`TECH_DEBT_REPORT.md` à la racine avec score avant/après et prochaines actions.

---

## Annexe : commandes de vérification

```bash
# Recompter any après corrections
grep -r ': any\|as any\|<any>\|any\[\]' app/ components/ lib/ types/ --include="*.ts" --include="*.tsx" | wc -l

# Recompter console.*
grep -r 'console\.\(log\|warn\|error\|debug\|info\)' app/ components/ lib/ --include="*.ts" --include="*.tsx" | wc -l

# Vérifier auth API
grep -rn 'getUser(' app/api/ --include="*.ts"  # devrait être vide

# Vérifier auth pages
grep -rn 'getSession(' app/ --include="*.tsx" | grep -v '/api/'  # devrait être vide
```

---

**Fin PASSE 1**. Rapport prêt pour validation utilisateur avant PASSE 2.
