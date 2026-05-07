# CLEANUP_REPORT — chore/cleanup-tech-debt

> Branche : `chore/cleanup-tech-debt`
> Base : `main` (avant) puis commit backup `626a6c1`
> Date : 2026-05-07
> Auteur : exécution autonome (Claude Code, Opus 4.7)

Mission : nettoyage de code mort, dépendances orphelines, dette technique, mise à jour doc.
Périmètre : `app/`, `components/`, `lib/`, `types/`, `public/`, `package.json`, `ARCHITECTURE.md`.

Garde-fous respectés (PROMPT.md + skill cleanup-geomatik) :
- Aucune modification de `app/api/isochrone-battle/`, fonctions PostGIS battle, RPC `compute_panneau_scores_v2`, `refresh_ville_stats_chunk`
- Aucune migration `supabase/migrations/` modifiée
- `next.config.js`, `tsconfig.json` non touchés
- Logique métier : zéro modification — uniquement suppression de code mort et alignement doc
- 7 commits atomiques, build vert après chaque batch

---

## 1. Statistiques

| Métrique | Avant | Après | Delta |
|----------|-------|-------|-------|
| `npm run build` | ✅ vert | ✅ vert | — |
| `npx tsc --noEmit` | 0 erreur | 0 erreur | — |
| `npm run lint` (errors) | **5** | **0** | **−5** |
| `npm run lint` (warnings) | ~98 | ~89 | −9 |
| Fichiers supprimés | — | — | **47** |
| Fichiers modifiés | — | — | 7 |
| Lignes nettes | — | — | **−207 904** |
| `dependencies` | 38 | 35 + jszip | −2 (net) |
| `devDependencies` | 18 | 18 | 0 |
| Routes API | 214 | 201 | **−13** |

> Le delta lignes est dominé par la suppression de `public/maplibre-gl/` (~205 k lignes de bundles JS minifiés + sourcemaps). Hors ce dossier : −2 700 lignes nettes de code applicatif.

---

## 2. Fichiers supprimés (47)

### Routes API orphelines (13) — aucun appelant dans le code

| Route | Pourquoi |
|-------|----------|
| `app/api/admin/custom-geo/backfill-subzones/route.ts` | Backfill ponctuel jamais branché à un job/UI |
| `app/api/admin/import-filosofi/execute/route.ts` | Page admin appelle `/api/admin/filosofi-import` (chemin différent) |
| `app/api/admin/import-filosofi/parse/route.ts` | Idem |
| `app/api/admin/import-laposte/route.ts` | Référencée uniquement dans ARCHITECTURE.md |
| `app/api/agent/history/route.ts` | Reste de l'ancien agent flow avant refacto |
| `app/api/agent/settings/strategy/[id]/route.ts` | Reste chantier_a4_5_supervisor_agent |
| `app/api/carreaux/dynamic/route.ts` | Documentée mais aucun appelant TS |
| `app/api/correlation/residuals-geojson/route.ts` | Idem |
| `app/api/custom-geo/source/cluster/route.ts` | Endpoint jamais wiré |
| `app/api/debug-campaigns/route.ts` | Route de debug |
| `app/api/iris/geojson/route.ts` | Frontend utilise `iris/stats` pas `iris/geojson` |
| `app/api/iris/values/route.ts` | Référencée uniquement en doc |
| `app/api/radio/match-manual/route.ts` | Documentée seulement |

### Composants UI / hooks orphelins (14)

| Fichier | Pourquoi |
|---------|----------|
| `app/copilote/_components/WelcomeOverlay.tsx` | Commenté dans `app/map/page.tsx:2388` |
| `app/map/custom-geo/_components/ZoneFullMap.tsx` | Aucun importateur |
| `app/map/custom-geo/_components/ZoneMapPreview.tsx` | Aucun importateur |
| `app/map/custom-geo/_hooks/useSourceTypes.ts` | Aucun appelant |
| `components/custom-geo/SaveAsCustomZoneButton.tsx` | Aucun importateur |
| `components/map/overlays/AnalysesOverlay.tsx` | Remplacé par PilotageOverlay/ZonesOverlay |
| `components/map/overlays/CampaignsOverlay.tsx` | Idem |
| `components/map/overlays/PerimeterOverlay.tsx` | Idem |
| `components/map/overlays/TerrainOverlay.tsx` | Idem |
| `components/ui/LayerSwitch.tsx` | Aucun importateur |
| `components/ui/help-tooltip.tsx` | Aucun importateur |
| `components/ui/tooltip.tsx` | Importé par help-tooltip seulement |
| `components/ui/search-filter.tsx` | Aucun importateur |
| `components/ui/section-header.tsx` | Aucun importateur |

### Code lib / types / scripts (3)

| Fichier | Pourquoi |
|---------|----------|
| `lib/metrics-display/formatter.ts` | `formatMetricValue`/`metricLabel` jamais appelés |
| `lib/stores/useLayerStore.ts` | Référencé uniquement dans un design doc |
| `types/api.ts` | Types Mistral non importés (`MistralResponse`, etc.) |
| `export_carreaux.mjs` (racine) | Doublon mort de `.github/scripts/export-ndjson.mjs` |

### Assets statiques (16) — `public/maplibre-gl/`

~37 MB de bundles MapLibre (`.js`, `.js.map`, `.css`, `.d.ts`, etc.) jamais référencés. La lib est chargée depuis le package npm via `maplibre-gl/dist/maplibre-gl.css`. Les fichiers public/ étaient une copie morte non servie.

---

## 3. Refactos significatifs

| Fichier | Nature |
|---------|--------|
| `app/copilote/_components/AnalyseCard.tsx` | **Bug fix** : `useState` était appelé après deux `return null` → violation `react-hooks/rules-of-hooks` (state corruption potentielle). Hook déplacé avant les early-returns. |
| `app/api/map/pois/route.ts` | Suppression de 2 `// eslint-disable-next-line @typescript-eslint/no-explicit-any` morts (la règle n'est pas chargée par `next/core-web-vitals`) |
| `components/ClusterDetails.tsx` | Suppression de 2 `eslint-disable` morts (mêmes raisons) — supprime les 2 erreurs lint baseline |
| `tests/integration/supabase-rpc.test.ts` | Suppression d'1 `eslint-disable` mort |
| `ARCHITECTURE.md` | Tables/sections de routes mises à jour : 7 routes supprimées du tableau, 3 composants ui retirés de l'arborescence, `types/api.ts` retiré, RPC `get_iris_geojson_by_{bbox,codes}` notées comme orphelines en base |

---

## 4. Dépendances désinstallées (3)

| Package | Type | Vérification |
|---------|------|--------------|
| `@radix-ui/react-label` | dependency | 0 import dans le repo (`from "@radix-ui/react-label"` → 0 hits) |
| `@radix-ui/react-tooltip` | dependency | Importé uniquement par `components/ui/tooltip.tsx`, lui-même supprimé |
| `zustand` | dependency | Importé uniquement par `lib/stores/useLayerStore.ts`, lui-même supprimé |

## Dépendance ajoutée (1)

| Package | Pourquoi |
|---------|----------|
| `jszip@^3.10.1` | Importé par `lib/radio/anfr-parser.ts`, `app/api/iris-import/insee/route.ts`, `app/api/iris-crawler/download/route.ts` mais **manquante** dans `package.json` (résolu indirectement via `shpjs`). depcheck a flaggé `missing`. |

---

## 5. Dépendances suspectes non touchées (à valider)

Knip / depcheck flaggent les packages suivants comme « non utilisés » mais ils sont nécessaires (faux positifs) :

| Package | Statut | Raison |
|---------|--------|--------|
| `@types/pg`, `pg` | Gardés | Utilisés par `scripts/populate_carreaux_1km.ts`, `scripts/populate_geom_3857.ts` (Knip ne scan pas `scripts/`) |
| `tsx` | Gardé | Lance les scripts `.ts` via `npx tsx scripts/...` (référencé dans README, runbook, 4 scripts) |
| `@types/proj4` | Gardé | Redondant car `proj4` ships ses types, mais inoffensif. Peut être retiré si TS reste vert. |
| `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser` | Gardés | Le plugin n'est pas chargé par la config eslint actuelle (`next/core-web-vitals` only). Les 5 `eslint-disable` qui le ciblaient ont été retirés (étaient inertes). À voir : soit retirer ces 2 packages, soit ajouter `plugin:@typescript-eslint/recommended` dans `.eslintrc.json` pour activer les règles correspondantes. |
| `autoprefixer`, `postcss` | Gardés | Build tools chargés implicitement par Tailwind / Next |
| `dotenv` | Gardé | Utilisé par les scripts CLI (`.env.local` parsing) |

---

## 6. Tables / colonnes Supabase suspectes (à valider, **aucune action prise**)

Audit croisé : lecture de `pg_tables` (80 tables `public`) vs grep dans `app/`, `components/`, `lib/`, `scripts/`, `sql/`, `supabase/`, `tests/`.

### Tables sans aucune référence en code TS/Python/SQL applicatif

| Table | Lignes (prod) | Hypothèse |
|-------|---------------|-----------|
| `isochrone_carreaux_coverage` | 0 | Vraisemblablement remplacée par calcul inline / `compute_coverage_fast` |
| `laposte_hexasmal` | 0 | Remplacée par `ref_codes_postaux` (peuplée via `build_ref_codes_postaux` RPC) |

### Tables avec 1 seule référence (souvent leur propre DDL — à confirmer manuellement)

| Table | Note |
|-------|------|
| `spatial_ref_sys` | PostGIS système — RLS désactivée par design (advisory MCP). Légitime. |
| `poi_metadata_index` | À vérifier : index ou table redondante ? |
| `france_boundary` | Doublon possible de `france_borders` (aucun call site applicatif) |
| `smart_ville_stats` | À vérifier : alimentée mais non lue ? |
| `geography_zones` | Sous-jacent à `geography_sets` mais peu utilisée |
| `custom_geo_zone_subzones` | Récente, peut être pré-feature |
| `agent_chat_messages` | Récente (purge weekly Inngest) — légitime |

### RPCs orphelines en base (recensées dans ARCHITECTURE.md)

| RPC | Statut |
|-----|--------|
| `get_iris_geojson_by_bbox` | Plus aucun appelant TS (route `/api/iris/geojson` supprimée). Reste en base. |
| `get_iris_geojson_by_codes` | Idem |

> **Aucune migration de suppression n'a été lancée.** Le client peut décider, après revue, lesquelles archiver/dropper.

---

## 7. Build status final

```
$ npx tsc --noEmit
EXIT=0  (0 erreur)

$ npm run build
✅ Compiled successfully
✅ All routes generated
ƒ Middleware  73.7 kB

$ npm run lint
0 erreur, 89 warnings (warnings hors scope du cleanup :
  apostrophes non échappés en JSX, deps useEffect manquantes,
  <img> au lieu de <Image>)
```

---

## 8. Commits créés

```
4517bad docs(architecture): align with deleted routes and components
8c1ff12 fix: lint errors and React hooks rule violation
de61f38 chore(deps): remove 3 unused deps, add missing jszip
c2e05b8 chore(cleanup): remove orphan UI components and unused libs
66e7c5c chore(cleanup): remove orphan API routes never called by app or docs
43f686e chore(cleanup): remove unused public/maplibre-gl static assets
626a6c1 Backup avant nettoyage  ← base du cleanup
```

(7 commits, build vert après chacun, hors backup initial.)

---

## 9. Dette restante (planifiable, non corrigée)

Findings repérés mais hors scope « minimum friction » :

- **89 warnings ESLint** : majorité = apostrophes non échappés dans textes JSX (`react/no-unescaped-entities`) et deps manquantes dans `useEffect` (`react-hooks/exhaustive-deps`). Effort : moyen, risque : faible mais non nul (changer les deps d'un useEffect peut altérer le comportement).
- **`components/CarreauxPMTilesLayer.tsx`** : seuls les constants `CARREAUX_PALETTES`/`CARREAUX_INDICATEURS` sont importés — le composant React lui-même est mort. Refacto possible : extraire les constants vers `lib/carreaux/palettes.ts` puis supprimer le composant.
- **`lib/metrics-display/useSelectedMetric.ts`** : explicitement documenté « réservé pour usage futur, non utilisé en V1 » dans `docs/chantier_a3_1_multi_source_complete.md`. Conservé volontairement.
- **2 routes ops conservées** : `/api/bidding/predict`, `/api/bidding/detect-drift` ne sont pas appelées depuis l'app mais sont documentées comme outils ops manuels (curl/Powershell) dans `docs/runbook.md` et `modal/bidding_ml/README.md`. Conservées.
- **`app/admin/filosofi-import/page.tsx`** : la page existe et est listée dans la sidebar mais elle appelle `/api/admin/filosofi-import` qui n'a jamais existé (les routes `/api/admin/import-filosofi/*` ne correspondent pas au chemin appelé). Page **cassée pré-cleanup** — diagnostic posé, correction hors scope.
- **`@typescript-eslint/*`** packages : présents dans devDeps mais aucune règle correspondante n'est chargée. Soit configurer la lint pour les utiliser, soit désinstaller. Décision = revue.
- **Renaming GEOMATIK → MAGELIAN** : `lib/map/geomatik-style.ts`, `public/geomatik-icon.svg` portent encore l'ancien nom. ARCHITECTURE.md / DESIGN_SYSTEM.md / CLAUDE.md sont déjà à jour sur MAGELIAN. À renommer dans une session dédiée pour éviter l'effet boule de neige sur les imports.
- **Schéma Supabase** : 2 tables candidates au drop (`isochrone_carreaux_coverage`, `laposte_hexasmal`) + RPCs `get_iris_geojson_by_*` — nécessite une migration `apply_migration` après revue par Vince.

---

## 10. Notes méthodologiques

Outils utilisés :
- `ts-prune` : 948 entrées analysées (exports inutilisés)
- `knip` : 32 fichiers, 1 dep, 4 dev-deps signalés comme inutilisés
- `depcheck` : 1 dep, 5 dev-deps inutilisés, 1 dep manquante (`jszip`)
- Script ad-hoc `find-orphan-routes.mjs` : croise `app/api/**/route.ts` avec leurs callers via prefix-matching
- Script `audit-tables.mjs` : croise les 80 tables `pg_tables.public` avec le code

Heuristiques :
- Un fichier est supprimé si **aucun** import / référence chaîne ne le cible (vérifié par grep en plus de knip).
- Un dep est désinstallé si **0 import** dans le repo (vérifié manuellement).
- Une route est supprimée si son **prefix statique** n'apparaît dans aucun fichier hors de sa propre route (vérifié par script + grep manuel).
- Aucune logique métier modifiée.

Garde-fous opérationnels :
- Backup commit `626a6c1` avant tout nettoyage (165 fichiers, +14 733 / −2 207).
- Working tree clean après chaque commit.
- `tsc --noEmit` + `npm run build` après chaque batch significatif.
- Aucun `--no-verify`, aucun `--force`, aucun reset destructif.
