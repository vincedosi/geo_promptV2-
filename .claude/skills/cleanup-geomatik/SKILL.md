---
name: cleanup-geomatik
description: >
  Protocole de nettoyage, sécurisation et documentation de la codebase GEOMATIK.
  Utilise cette skill pour TOUTE opération de cleanup, audit, refactoring, chasse
  au code mort, audit de sécurité, qualité TypeScript, documentation, ou quand
  le prompt mentionne nettoyage, cleanup, audit, refactor, dead code, dette
  technique, ARCHITECTURE.md, JSDoc, ou grand ménage de la codebase.
  Définit les garde-fous GEOMATIK (fichiers interdits, principes absolus,
  contraintes Nano) qui s'appliquent à toute opération de maintenance.
---

# Grand nettoyage GEOMATIK

## Pré-requis obligatoire avant tout cleanup

```bash
cd C:\GENESIS\genesis_app
git add -A && git commit -m "chore: backup avant cleanup"
git push origin main
```

**Si cette sauvegarde n'est pas faite → STOP, demander à Vince de la faire avant.**

## Principe directeur

Travail **ITÉRATIF et PRUDENT**. Chaque étape = rapport d'abord, corrections après validation explicite. `npm run build` doit passer après chaque étape de correction.

---

## ⛔ Fichiers et composants INTERDITS — ne jamais toucher

### Code métier critique
- `/api/isochrone-battle/route.ts`
- Fonctions PostGIS `battle_*`, `get_isochrone_battle`, `clip_geojson_to_france`, `clip_rings_to_france`
- RPC `compute_panneau_scores_v2` → modifier avec extrême prudence uniquement

### Migrations et DB
- Les migrations Supabase déjà appliquées en prod → JAMAIS modifier
- Les nouvelles migrations passent via MCP `apply_migration` uniquement
- Les RPCs existantes → JAMAIS renommer (casse le code client)

### Config
- `.env`, `.env.local`, `next.config.js`, `tailwind.config.*`, `supabase/config.toml` → NE PAS TOUCHER sauf demande explicite
- `CLAUDE.md`, `DESIGN_SYSTEM.md` → lire avant de coder, ne pas modifier

### Features multi-tenant récentes (à vérifier avant toute modif)
- Tables : `organization_members`, `campaign_organizations`
- Fonctions SQL : `get_user_org()`, `get_user_role()`, `get_user_orgs()`
- Routes : `/api/admin/users`, `/api/admin/organizations`, `/api/admin/campaigns/**`, `/api/user/switch-org`, `/api/user/organizations`
- Pages : `/admin/users`, `/admin/organizations`
- Policies RLS sur : `dsp_campaigns`, `dsp_campaign_data`, `data_sources`, `panneaux_affichage`, `poi_france`, `saved_maps`, `scoring_profiles`, `profiles`, `organizations`, `organization_members`, `campaign_organizations`

---

## ⛔ Principes absolus GEOMATIK (rappels cleanup)

1. **RIEN n'est codé en dur** — IRIS columns (information_schema), régies (DISTINCT), rôles, orgs, catégories → TOUT dynamique
2. **Déterminisme** — aucun aléa, aucune approximation sur les matchings
3. **`adminFetch()`** pour routes admin (pas `fetch()`)
4. **`getSession()`** sur routes API (pas `getUser()` — cause 409)
5. **Contraintes Supabase Nano** : max 3 requêtes parallèles, bbox viewport seulement, batch par 50, pas de full-scan `iris` (51k) ni `carreaux_filosofi` (2.3M)
6. **PostgREST limit** : truncate à 5000 rows → RPC JSON ou `.limit(100000)`

---

## Séquence de cleanup — 8 parties

### Partie 1 — Chasse au code mort

**1.1 Audit (rapport uniquement, NE SUPPRIME RIEN)**

Catégories à auditer :
- **Front** : composants non rendus, hooks non utilisés, imports inutiles, fonctions orphelines, code commenté mort, fichiers dupliqués
- **Routes API** : routes jamais appelées, routes dupliquées.
- **Supabase** : migrations locales orphelines, Edge Functions non référencées. ⚠️ RLS récent multi-tenant critique
- **Scripts** : scripts orphelins, doublons d'import. ⚠️ Scripts psycopg2 (radio, IRIS, carreaux, SIRENE) critiques
- **Deps package.json** : packages jamais importés (vérifier avec `npm ls` — peut être peer). Vérifier que `maplibre-gl`, `pmtiles`, `@supabase/*` sont tous gardés
- **Config** : vars env référencées mais absentes de `.env.example`, vars de `.env.local` jamais utilisées, fichiers `.tmp`/`.bak`/`.old`/`.DS_Store`

**Features potentiellement mortes à questionner (ne pas supprimer sans validation explicite)** :
- Code legacy "GENESIS" avant pivot GEOMATIK (geo.prompt et toute l'IA sont déjà supprimés : ne rien y réintroduire)
- ELM (État Local de Marché) — partiellement scopé, SIRENE pas fini
- Composants /clusters standalone (refonte prévue vers Sheet overlay)
- Vieux code matching radio Pass 1 avant refacto many-to-many
- Vieux scoring POI `ST_Contains` avant Gaussian scoring

**1.2 Suppression (après validation fichier par fichier)**
- Supprimer les éléments validés un par un
- Pour tout FICHIER ENTIER → demander confirmation explicite
- `npm run build` après
- Commit : `chore(cleanup): remove dead code — <résumé>`

### Partie 2 — Sécurité

**2.1 Audit (rapport uniquement)**

🔴 **Critique** :
- Routes admin sans `requireAdmin()` ou `getUserFromRequest()`
- Routes qui lisent/modifient users/orgs/campagnes sans guards
- `fetch()` sur URL client sans whitelist (SSRF) — whitelist à proposer : arcom.fr, insee.fr, datagouv, github.com, openrouteservice.org
- Identifiants hardcodés (UUID, API keys Gemini/Mistral/Supabase, tokens)
- Clés Supabase `service_role` leakées côté client
- `createAdminClient()` dans du code client
- Validation manquante sur `organization_id`/`user_id` du body (IDOR)

🟡 **Modéré** :
- Données sensibles (emails, tokens) dans `console.log`
- POST/PUT/DELETE sans validation du body
- Erreurs qui leakent stack traces / SQL / paths
- Cache invalidable sans auth
- Rate limiting absent sur routes coûteuses (imports, IA, isochrones)

🟢 **Mineur** :
- Headers sécu (CSP, HSTS, X-Frame-Options)
- Cookies sans `httpOnly`/`secure`/`sameSite`

**Cibles prioritaires (routes récentes)** : `/api/admin/users`, `/api/admin/organizations`, `/api/admin/campaigns/**`, `/api/user/switch-org`, `/api/user/organizations`, toutes les routes d'import CSV.

**2.2 Corrections** après validation. Commit : `security: <résumé>`

### Partie 3 — Qualité TypeScript

**3.1 Audit**
- Traquer les `any` explicites et catégoriser :
  - **A** : fixable avec vrai type → proposer
  - **B** : `catch (e: any)` → uniformiser `catch (e: unknown)` + `instanceof Error`
  - **C** : vendor (MapLibre events, Gemini responses, Supabase rpc) → documenter
  - **D** : JSONB Supabase (`config`, `profil` scoring, `mapping` data_sources) → commenter la structure attendue
- `// @ts-ignore` / `// @ts-expect-error` → corrigeable ou documenter
- Props React typées partout (surtout composants admin récents)
- Types request/response sur routes API
- `npx tsc --noEmit` → lister erreurs
- Vérifier `database.types.ts` cohérent avec schéma

**3.2 Corrections** : `npx tsc --noEmit` → 0 erreur. Commit : `refactor(types): <résumé>`

### Partie 4 — Qualité React & Architecture

**4.1 Audit**
- **Organisation** : fichiers mal rangés, `../../../` au lieu de `@/`, nommage incohérent, barrel exports manquants
- **Composants** : >200 lignes → découper, logique métier dans JSX → extraire en hook, `useEffect` avec deps manquantes, props drilling 3+ niveaux, `'use client'` manquant ou en trop, MapLibre sans `useMemo`/`useCallback`
- **Routes API** : try/catch incohérent, routes trop longues, N+1 queries (attention Nano), plus de 3 `Promise.all()` Supabase (risque I/O), `requireAdmin()` incohérent
- **Duplication** : matching postal→IRIS répété, filtrage org répété (admin vs digital), composants UI dupliqués (modals, tables, badges)

**4.2 Corrections** : REFACTORER LA FORME, PAS LE FOND — zéro modification de logique métier. Commit : `refactor(arch): <résumé>`

### Partie 5 — Documentation

**5.1 ARCHITECTURE.md** à la racine :
- Stack (Next.js 14, React 18, TS, Supabase PostGIS, MapLibre 5.x, PMTiles, Tailwind — versions exactes)
- Arborescence commentée (`app/`, `components/`, `lib/scoring/`, `scripts/`, `supabase/`)
- Modèle multi-tenant (hiérarchie orgs/rôles, `organization_members`, `campaign_organizations`, `get_user_org()`, `get_user_role()`)
- Pipelines d'import (INSEE, Filosofi, ANFR, Arcom, SIRENE)
- Flux MapLibre (PMTiles + MVT)
- **Liste complète des RPC PostGIS** : `get_digital_campaigns_list`, `get_campaign_medias`, `get_digital_campaign_map`, `get_digital_analysis_breakdown`, `compute_poi_accessibility`, `compute_panneau_scores_v2`, `match_campaign_postal_to_iris`, `get_user_role`, `get_user_org`, `get_user_orgs`, `get_isochrone_battle` ⛔, etc. — pour chaque : nom, description, fichier appelant
- **Tables groupées par domaine** :
  - Auth/tenant : `profiles`, `organizations`, `organization_members`
  - Campagnes : `dsp_campaigns`, `dsp_campaign_data`, `campaign_organizations`
  - Géo : `iris`, `carreaux_filosofi`, `panneaux_affichage`, `poi_france`, `comptages_routiers`
  - Radio : `emetteur_radio`, `radio_stations`, `emetteur_radio_stations`
  - Scoring : `scoring_profiles`, `scoring_results`, `poi_accessibility_config`
  - Support : `saved_maps`, `data_sources`, `data_registry`
- Policies RLS par table (qui voit quoi)
- Variables d'env (groupe Supabase / IA / External APIs)
- Commandes (dev, build, lint, deploy Vercel, migrations MCP, gen types)
- Routes API groupées par domaine
- Scripts utilitaires (1 ligne chacun)
- Contraintes opérationnelles (Nano, PostgREST limit, PMTiles GitHub Releases, MapLibre 5.x gzip)

**5.2 README.md** : install + prérequis + séquence launch Claude Code Dentsu + liens vers ARCHITECTURE.md / CLAUDE.md / DESIGN_SYSTEM.md

**5.3 JSDoc** : fonctions exportées `lib/` et `utils/`, hooks custom, composants principaux, RPC Supabase. Priorité : nouveaux fichiers multi-tenant.

**5.4 .env.example** : TOUTES les vars env avec commentaire, groupées par catégorie.

Commit : `docs: architecture + readme + jsdoc`

### Partie 6 — Supabase

1. Lister toutes les RPC appelées (`supabase.rpc(...)`) → vérifier existence en base via MCP `execute_sql` sur `pg_proc`
2. Vérifier/régénérer `database.types.ts` si périmé
3. Documenter tables + relations dans ARCHITECTURE.md
4. Lister policies RLS avec leur logique
5. Identifier migrations locales orphelines (à archiver après validation)
6. Vérifier qu'aucun script ne modifie le schéma sans `apply_migration`

### Partie 7 — Polish final

**7.1 Console.log** : lister tous `console.log`/`warn`/`error`, catégoriser (A) debug à supprimer / (B) logging utile, supprimer (A). Envisager `lib/logger.ts` si absent.

**7.2 TODO/FIXME/HACK/XXX** : lister avec fichier+ligne. Pertinent ou mort ? Les pertinents → issues GitHub ou ticket référencé.

**7.3 Accessibilité basique** : `<button>` sans `type`, `<img>` sans `alt`, inputs sans `<label>`/`aria-label`, `onClick` sur `<div>`/`<span>` sans ARIA, contraste dark minimal.

**7.4 Vérifications finales** :
- `.gitignore` couvre `.env.local`, `node_modules`, `.next`, `*.tmp`, `*.bak`, `.vercel`, `.turbo`
- Pas de `package-lock.json` corrompu ni `node_modules` tracké
- Pas de `.tmp`/`.bak`/`.old`/`.DS_Store` dans le repo
- Aucun secret hardcodé (grep `sk-`, `eyJ`, UUID patterns suspects)
- Pas de `.pyc`/`__pycache__` tracké

Commit : `chore: final polish`

### Partie 8 — Bilan CHANGELOG-CLEANUP.md

Générer à la racine :
- Code supprimé (fichiers, composants, packages, lignes + chiffres)
- Sécurité (failles corrigées, classées 🔴🟡🟢)
- TypeScript (`any` corrigés, catch uniformisés, erreurs tsc résolues)
- Architecture (refactorings, composants découpés, hooks extraits)
- Documentation (fichiers créés/modifiés)
- Polish (console.log, TODO, a11y)
- **Dette restante planifiable** (findings non corrigés + pourquoi)
- **Avant/Après chiffres** : fichiers, LOC (via `cloc` si dispo), `any` restants, warnings tsc, failles sécu, taille bundle `.next`

Commit final : `docs: changelog cleanup — bilan final`

---

## Règles strictes (toutes étapes)

1. NE CASSE PAS les fonctionnalités existantes — en cas de doute, demander
2. `npm run build` doit passer après chaque étape
3. Si tests existent → `npm test` aussi
4. Résumé après chaque étape avec liste des fichiers modifiés
5. Doute sur fichier/fonction → DEMANDER plutôt que supprimer
6. NE MODIFIE AUCUNE LOGIQUE MÉTIER — forme uniquement
7. Ne touche pas aux fichiers de config sauf demande
8. Ne touche pas aux migrations prod
9. Ne renomme pas les RPC Supabase
10. `/api/isochrone-battle/route.ts` et fonctions `battle_*` → INTERDIT
11. `.gitignore`, `CLAUDE.md`, `DESIGN_SYSTEM.md` intacts
12. Respecte contraintes Nano (pas de full-scan iris/carreaux)
13. Respecte principes GEOMATIK (rien en dur, déterminisme, adminFetch, getSession)
14. Chaque partie → commit Git conventional commits

---

## Mode d'invocation

### Cleanup complet
```
Lance le protocole de nettoyage complet avec @cleanup-geomatik.
Commence par la Partie 1 — Étape 1.1 : audit du code mort.
```

### Cleanup partiel (une seule partie)
```
Applique @cleanup-geomatik Partie 2 uniquement (audit sécurité).
Rapport d'abord, on valide avant corrections.
```

### Cleanup ciblé (un dossier/module)
```
Applique @cleanup-geomatik sur /app/admin uniquement.
Toutes les parties applicables à ce périmètre.
```

## Invariants respectés automatiquement par cette skill

- Sauvegarde git préalable obligatoire
- Pas de suppression sans validation explicite
- Pas de modification de logique métier
- Respect de toutes les contraintes techniques GEOMATIK (Nano, PostgREST, RLS multi-tenant, RPC interdites)
- Commits atomiques conventional commits par partie
- `npm run build` passant après chaque étape
