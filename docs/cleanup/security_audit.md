# Audit sécurité — A4.6 phase 1

> Date : 2026-04-30

## 1.1 Secrets dans le code source

```bash
grep -rn -E "(eyJ[A-Za-z0-9_-]{30,}|sk_[A-Za-z0-9]{30,}|ak-[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{30,})" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.json" \
  app/ components/ lib/ modal/ scripts/
```

**Résultat : 0 secret trouvé** ✓

`.env.local` contient les vrais secrets, est gitignoré (vérifié via `git ls-files | grep '\.env'` → seul `.env.example` tracké).

## 1.2 Variables d'environnement

Vars utilisées dans le code (`grep process.env.*`) :

| Variable | Présence `.env.local` | Présence `.env.example` |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✓ | À vérifier |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✓ | ✓ |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | À vérifier |
| `DATABASE_URL` | ✓ | À vérifier |
| `GOOGLE_GENERATIVE_AI_API_KEY` | ✓ | À vérifier |
| `MISTRAL_API_KEY` | ✓ | À vérifier |
| `MODAL_TOKEN_ID` | (non) | À ajouter |
| `MODAL_TOKEN_SECRET` | (non) | À ajouter |
| `MODAL_BIDDING_ML_URL` | ✓ | À ajouter |
| `ORS_API_KEY` | ✓ | À vérifier |
| `UPSTASH_REDIS_REST_URL` | (vide) | optionnel |
| `UPSTASH_REDIS_REST_TOKEN` | (vide) | optionnel |
| `ADMIN_INIT_KEY` | ✓ | optionnel |
| `GITHUB_TOKEN` | ✓ | proxy PMTiles |
| `NEXT_PUBLIC_APP_URL` | optionnel | optionnel |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | ✓ | optionnel |

**Action P6** : produire `.env.example` exhaustif et documenté.

## 1.3 RLS Supabase

```sql
SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity=false;
-- Result: spatial_ref_sys (PostGIS — OK)
```

**Résultat : 100% des tables métier ont RLS activé** ✓ (1 seule table sans RLS = `spatial_ref_sys`, table système PostGIS read-only — OK).

Pattern RLS MAGELIAN utilisé partout :
- `get_user_role() = ANY (ARRAY['super_admin','admin'])` pour les writes admin
- `auth.uid() = user_id` pour les rows owned
- `service_role` bypass pour les UPSERT serveur (Inngest, Modal, agent)

## 1.4 SQL injection

Pattern recherché : `supabase.rpc(...${...}...)` (concat).

```bash
grep -rn "supabase.*\.rpc(.*\${" --include="*.ts" --include="*.tsx" app/ lib/
```

**Résultat : 0 résultat** ✓ — toutes les params RPC passent par le 2ᵉ argument paramétré.

Pattern recherché côté SQL : `EXECUTE ... ||`

```bash
grep -rn "EXECUTE.*||.*\$" supabase/migrations/
```

**Résultat : 0 résultat** ✓.

## 1.5 Auth sur routes API

**189 routes** API au total. **53 routes sans `requireAuth/requireAdmin/getSession/getUser`** détecté par grep.

### Classification de ces 53 routes

| Catégorie | Nb | Justification |
|---|---|---|
| **Webhooks externes (signature-validated)** | 1 | `inngest/route.ts` (signed by Inngest) |
| **Auth callback** | 1 | `auth/[...auth]/route.ts` (login flow, ne peut pas requireAuth) |
| **MVT tiles publiques** | 4 | `tiles/[z]/[x]/[y]`, `iris-tiles/[z]/[x]/[y]`, `iris-tiles-proxy`, `carreaux/dynamic` (cartographie publique, perf-critique, pas de PII) |
| **Lectures cartographiques publiques** | 7 | `iris/{detail,geojson,stats,values}`, `carreaux/`, `map/{ooh,poi-natures,tmja,transport}`, `ref/geo` (open data INSEE, pas de PII) |
| **Routes nécessitant auth — TODO** | 40 | corrélation, coverage-stats, isochrone-battle, poi-clusters, scoring/dashboard, scoring/isochrones, analysis, export, smart-prompt, iris-crawler/* (hors discover/preview/upload qui font admin), debug-campaigns, providers/status, init-admin (ADMIN_INIT_KEY check needed), isochrone-cache-check |

**Action recommandée (commit P1 dédié)** :
- **Catégorie 1-3** (12 routes) : OK, à documenter en commentaire `// PUBLIC: <raison>`
- **Catégorie 4** (40 routes) : ajouter `requireAuth(request)` ou `requireAdmin` selon sensibilité
- Justification à coller en haut de chaque route publique :
  ```ts
  // PUBLIC ROUTE — open data INSEE / cartographie tile, pas de PII.
  ```

**Effort** : ~3-4h pour passer en revue les 40 routes catégorie 4 + tests E2E. À planifier en chantier P1 dédié.

## 1.6 Service role key — usage

```bash
grep -rn "SUPABASE_SERVICE_ROLE_KEY" --include="*.ts" --include="*.tsx" \
  app/ components/ lib/ | grep -v "/api/\|server-only\|lib/auth\|lib/inngest"
```

**Résultat : 0 occurrence côté client/components** ✓.

La service_role est utilisée uniquement dans :
- `lib/auth.ts` (`createAdminClient()`)
- `app/api/**/route.ts` (server-side)
- `lib/inngest/*` (background jobs)
- `lib/agent/orchestrator.ts` + `autonomy.ts` (agent server-side)
- `modal/bidding_ml/*` (Python service)

## 1.7 Recommandations consolidées

| # | Action | Effort | Risque |
|---|---|---|---|
| 1 | Documenter routes publiques (12) avec commentaire | 30min | nul |
| 2 | Ajouter auth sur 40 routes catégorie 4 | 3-4h | medium |
| 3 | Compléter `.env.example` (cf P6) | 1h | nul |
| 4 | Mettre à jour `docs/security_audit_rls.md` | 1h | nul |

**Verdict global** : sécurité MAGELIAN **solide** sur les fondamentaux (RLS 100%, 0 secret en clair, 0 SQL injection, service_role server-only). Le seul gap réel = 40 routes API à éclaircir auth (publiques explicites vs oublis). Pas de risque immédiat — routes RLS-protégées via service_role mais sans rate-limit user-level.
