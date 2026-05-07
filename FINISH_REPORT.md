# FINISH_REPORT — chore/cleanup-tech-debt (finitions)

> Branche : `chore/cleanup-tech-debt` (suite du `CLEANUP_REPORT.md`)
> Base : commit `5ea958c` (fin du cleanup precedent)
> Date : 2026-05-07
> Auteur : execution autonome (Claude Code, Opus 4.7)

Mission (cf. `docs/PROMPT.md`) : finir les 3 chantiers laisses ouverts par le cleanup precedent.

3 commits, build vert apres chacun, **aucune commande destructive sur Supabase**.

---

## Phase 1 — Rename GEOMATIK -> MAGELIAN

### Resume chiffre

| Item | Valeur |
|------|--------|
| Fichiers renommes | **2** |
| Fichiers modifies (replace inline) | **53** |
| Total occurrences remplacees | **442** |
| Build apres | ✅ vert |

### Fichiers renommes

- `lib/map/geomatik-style.ts` -> `lib/map/magelian-style.ts`
- `public/geomatik-icon.svg` -> `public/magelian-icon.svg`

Tous les imports et toutes les references `<img src="/geomatik-icon.svg">` mis a jour.

### Replace inline

Pattern : `GEOMATIK` -> `MAGELIAN`, `Geomatik` -> `Magelian`, `geomatik` -> `magelian` (case-sensitive, 1 passe).

Zones traitees :
- `app/`, `components/`, `lib/`, `types/` (TS, TSX, JS, JSX, CSS, SCSS)
- `ARCHITECTURE.md`, `README.md`, `DESIGN_SYSTEM.md` (la racine n'a pas de `CLAUDE.md` — celui-ci est sous `~/.claude/`, hors repo)
- `docs/**/*.md` (sauf `docs/PROMPT.md`, voir flaggage)
- `modal/bidding_ml/*.py`, `modal/bidding_ml/pyproject.toml`
- `package.json` non modifie : pas d'occurrence `geomatik` (le `name` est `genesis_app`, pas concerne)

### Items NON renommes (flagges)

| Cible | Type | Pourquoi |
|-------|------|----------|
| Tables Supabase contenant `geomatik` | Schema DB | Renommer = casse prod. Aucune table public.* contenant `geomatik` reperee. |
| Buckets Supabase Storage | Storage | Idem ; aucun bucket `geomatik` connu de cette session. |
| Branches Git, tags, anciens commits | Git history | Intouchable par rebase = casse PR/CI. |
| Repo GitHub `vincedosi/geo_promptV2-` | GitHub | Hors scope code-only. |
| `CLEANUP_REPORT.md` (2 occurrences) | Doc | Archive historique du cleanup precedent — explicit skip per PROMPT. |
| `docs/PROMPT.md` (10 occurrences) | Doc | Instructions utilisateur, mentionnent `GEOMATIK` historiquement (« Renommage GEOMATIK -> MAGELIAN »). |
| `supabase/migrations/*.sql` (5 occurrences sur 3 fichiers) | DB migrations | Migrations applicables en prod, protegees par PROMPT. |
| `.claude/skills/*.md` (29 occurrences sur 6 fichiers) | Local tooling | Les noms de dossiers (cleanup-geomatik, geomatik-ux, etc.) servent d'identifiants pour le `Skill` tool. Renommer casserait l'invocation des skills. Hors scope code app. |

Commit : `63fdebb refactor(brand): finish GEOMATIK to MAGELIAN rename`

---

## Phase 2 — Page `/admin/filosofi-import`

### Diagnostic

| Verification | Resultat |
|--------------|----------|
| Fichier de la page | `app/admin/filosofi-import/page.tsx` (810 lignes, parser Parquet/SHP/DBF) |
| Endpoint appele | `/api/admin/filosofi-import` (POST chunked) |
| Cet endpoint existe-t-il en code ? | **Non**. Aucune route `app/api/admin/filosofi-import/route.ts`. Les routes voisines `/api/admin/import-filosofi/{parse,execute}` sont un **chemin different** et ont ete supprimees comme orphelines dans le cleanup precedent (commit `66e7c5c`). |
| Page reference par la nav admin ? | **Oui** : `components/AppSidebar.tsx:59` declare `{ href: '/admin/filosofi-import', label: 'Filosofi Import', icon: PlusCircle, badge: 'Admin' }` |
| Autre `<Link href="/admin/filosofi-import">` ? | Non |
| Redirection middleware ? | Non |

### Decision (par regle PROMPT)

> « Si referencee quelque part : tu **ne supprimes pas**, tu ajoutes un TODO et tu flagges. »

La page est listee dans la sidebar -> **conservee**. Un commentaire `TODO(filosofi-import)` a ete ajoute au-dessus du composant principal pour expliciter le statut casse pre-cleanup.

```tsx
// TODO(filosofi-import): page cassée pré-cleanup, endpoint manquant — décider fix vs remove
// La page est listée dans components/AppSidebar.tsx mais appelle /api/admin/filosofi-import
// qui n'existe pas (et n'a jamais existé : les routes /api/admin/import-filosofi/* étaient un
// chemin différent, supprimées dans 66e7c5c car orphelines). Voir CLEANUP_REPORT.md.
export default function FilosofiImportPage() { ... }
```

### Action requise (Vincent)

3 options possibles :

1. **Re-implementer l'endpoint** `app/api/admin/filosofi-import/route.ts` (POST chunked accepting `data`, `columns`, `idcar_col`, `geom_col`, `resolution`, `millesime`).
2. **Re-router la page** vers les endpoints existants `/api/admin/import-filosofi/parse` + `/execute` (ressuscites depuis le commit backup `626a6c1` si necessaire).
3. **Supprimer la page** + son lien dans `AppSidebar.tsx:59` (decision a prendre apres revue de la pipeline d'import Filosofi : `app/admin/carreaux-import/page.tsx` semble couvrir un perimetre similaire).

Commit : `6d38f7c chore(admin): flag broken filosofi-import page for decision`

---

## Phase 3 — Validation Supabase findings

### Methode

Pour chaque candidat, 3 verifications **READ-ONLY** via MCP Supabase :

1. `SELECT pg_proc + pg_get_functiondef ILIKE '%<target>%'` — fonctions qui referencent
2. `SELECT pg_views + pg_views.definition ILIKE` + `information_schema.triggers` — vues/triggers
3. `SELECT pg_stat_user_tables` — stats d'usage (insert/update/delete + last_vacuum)

Plus : `Grep` recursif sur le code TS pour `supabase.rpc('<name>')`.

### Resultats — tableau de classification

| # | Cible | Type | Refs SQL | Refs code TS | Stats | Classification |
|---|-------|------|----------|--------------|-------|----------------|
| 1 | `isochrone_carreaux_coverage` | Table | 0 fonction, 0 vue, 0 trigger | 0 | 0 ligne, 0 INSERT/UPD/DEL ever | ✅ **SAFE TO DROP** |
| 2 | `laposte_hexasmal` | Table | **4 fonctions** : `build_ref_codes_postaux`, `truncate_laposte_hexasmal`, `update_laposte_centroids`, `get_digital_cp_iris_detail` | 0 directement, mais `get_digital_cp_iris_detail` est appele par `cp-detail/route.ts:25` | 0 ligne, 0 ecriture ever | ⚠️ **REVIEW NEEDED** |
| 3 | `get_iris_geojson_by_bbox` | RPC (function) | 0 fonction, 0 vue, 0 trigger | 0 (ancien caller `/api/iris/geojson` supprime dans `66e7c5c`) | n/a (function) | ✅ **SAFE TO DROP** |
| 4 | `get_iris_geojson_by_codes` | RPC (function) | 0 fonction, 0 vue, 0 trigger | 0 (idem) | n/a (function) | ✅ **SAFE TO DROP** |

### Surprise — pourquoi `laposte_hexasmal` n'est PAS safe

Le `CLEANUP_REPORT.md` initial avait note la table comme « 0 ref ». L'audit applicatif (grep sur le nom de la table) etait correct : aucun `from('laposte_hexasmal')` direct. **Mais 4 RPCs SQL la referencent** :

- 3 d'entre elles (`build_ref_codes_postaux`, `truncate_laposte_hexasmal`, `update_laposte_centroids`) etaient appelees uniquement par `/api/admin/import-laposte` — route supprimee. Donc orphelines en code.
- **`get_digital_cp_iris_detail` est encore appelee** par `app/api/digital/[campaignId]/cp-detail/route.ts:25`. La table etant vide, cette route renvoie probablement du vide actuellement — donc soit la feature « detail IRIS dans un CP » est cassee, soit elle a une fallback gracieuse, soit elle utilise d'autres tables aussi. **A verifier visuellement avant tout drop.**

### Livrable

Fichier `sql/cleanup/DROPS_PROPOSED.sql` cree avec 4 sections :

- ✅ SAFE TO DROP : 1 `DROP TABLE` + 2 `DROP FUNCTION` actifs (decommentes)
- ⚠️ REVIEW NEEDED : 3 options pour `laposte_hexasmal`, toutes commentees
- ❌ KEEP : note pour `get_digital_cp_iris_detail`
- Verifications post-drop incluses

**Aucune commande destructive lancee.** Le fichier est pret-a-coller apres backup Supabase manuel.

Commit : `58dbcc8 docs(supabase): prepare drop scripts for cleanup candidates`

---

## Build & lint status

```
$ npx tsc --noEmit
EXIT=0  (0 erreur)

$ npm run build
✅ Compiled successfully

$ npm run lint
0 erreur, 89 warnings (idem session precedente — hors scope)
```

---

## Commits crees pendant cette session

```
58dbcc8 docs(supabase): prepare drop scripts for cleanup candidates
6d38f7c chore(admin): flag broken filosofi-import page for decision
63fdebb refactor(brand): finish GEOMATIK to MAGELIAN rename
```

(3 commits sur la branche `chore/cleanup-tech-debt`, en plus des 8 du cleanup precedent.)

Etat complet de la branche depuis main :

```
58dbcc8 docs(supabase): prepare drop scripts for cleanup candidates
6d38f7c chore(admin): flag broken filosofi-import page for decision
63fdebb refactor(brand): finish GEOMATIK to MAGELIAN rename
5ea958c docs(cleanup): final report + prompt update
4517bad docs(architecture): align with deleted routes and components
8c1ff12 fix: lint errors and React hooks rule violation
de61f38 chore(deps): remove 3 unused deps, add missing jszip
c2e05b8 chore(cleanup): remove orphan UI components and unused libs
66e7c5c chore(cleanup): remove orphan API routes never called by app or docs
43f686e chore(cleanup): remove unused public/maplibre-gl static assets
626a6c1 Backup avant nettoyage
```

---

## Action requise par Vincent

### A1 — Page `/admin/filosofi-import` (Phase 2)

Decider entre les 3 options listees plus haut. Le TODO dans le code ne se ferme pas tout seul.

### A2 — Drop SQL Supabase (Phase 3) — **manuelle**

1. Faire un backup Supabase complet via le Dashboard (`Database > Backups`).
2. Ouvrir `sql/cleanup/DROPS_PROPOSED.sql`.
3. Executer **uniquement la section ✅ SAFE TO DROP** (3 statements) dans le SQL Editor Supabase.
4. Verifier les requetes post-drop incluses dans le fichier.
5. Decider de l'**Option A / B / C pour `laposte_hexasmal`** (cf. fichier).
6. Tester depuis l'app : `/map` (charge IRIS) et `/map/analyse/digital` (CP detail) doivent rester fonctionnels.

### A3 — Renommage skills locales (Phase 1, optionnel)

Les skills `.claude/skills/cleanup-geomatik`, `geomatik-ux`, `geomatik-metier`, `geomatik-product-vision`, `supabase-geomatik` et leurs fichiers `SKILL.md` portent encore l'ancien nom. Renommer ces dossiers casse l'invocation des skills (le `Skill` tool utilise le nom du dossier comme identifiant). Si Vincent veut renommer, il faut :
- Stop session Claude Code en cours
- Renommer les dossiers
- Mettre a jour les references croisees entre skills (`@cleanup-geomatik`, etc.)
- Mettre a jour les patterns `description` des skills

Strictement local, hors scope code app.

### A4 — Documents historiques (Phase 1)

`CLEANUP_REPORT.md` n'a pas ete touche (archive historique). Si Vincent veut la coherence absolue, il peut faire un find-replace manuel sur les 2 occurrences `GEOMATIK` qui y sont, **mais** modifier l'archive efface l'historique.

---

## Recap de la branche `chore/cleanup-tech-debt`

| Indicateur | Avant cleanup | Apres finitions |
|------------|---------------|-----------------|
| `npm run build` | ✅ vert | ✅ vert |
| `npx tsc --noEmit` | 0 erreur | 0 erreur |
| `npm run lint` (errors) | 5 | **0** |
| Routes API | 214 | 201 |
| Fichiers app/lib/types | 165 modifies au backup | -47 supprimes net |
| `dependencies` | 38 | 35 +jszip |
| `geomatik`/`Geomatik`/`GEOMATIK` dans le code app | nombreuses | **0** (seules les zones protegees en gardent : skills, migrations, archive) |
| RPCs documentees orphelines | 2 (mentionnees) | **prêtes au drop**, scripts livres |
| Tables candidates au drop validees DB | 2 | 1 SAFE + 1 REVIEW |
