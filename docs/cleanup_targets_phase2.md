# Inventaire cleanup A4.6.2 — Phase 0

> Date : 2026-04-30
> Objectif : cible précise pour Sous-phases A (any), B (console.log), C (refactor), D (doc).

## Sous-phase A — `any` / `@ts-ignore` (105 cibles)

| Zone | Nombre |
|---|---|
| `app/api/` | 38 |
| `app/` (pages) | 31 |
| `lib/` | 11 |
| `components/` | 7 |
| Autres (scripts, lib internals) | ~18 |
| **Total** | **105** |

Cible cleanup : **≤ 20 justifiés** (avec commentaire `// @ts-expect-error reason: <why>`).

Patterns courants observés :
- Lib externes non typées : `hyparquet`, `shpjs`, certains `@ts-ignore` sur `compressors: { ZSTD }`
- Données API/RPC mal typées (`(s: any) => …`)
- Generics oubliés sur `useState<any[]>` ou helpers

Stratégie :
1. Lib externes non typées → garder `any` + `// @ts-expect-error reason: lib X has no @types`
2. Data RPC → typer via interface (cf `lib/dsp-mapping/`, `lib/metrics-display/`)
3. UI handlers → utiliser `unknown` puis narrow

## Sous-phase B — `console.log` (149 cibles, 53 fichiers)

| Catégorie | Action | Estimation |
|---|---|---|
| Debug temporaire | DELETE | ~70 % |
| Logging utile prod | replace par `logger.info/warn/error` | ~20 % |
| Dev-only diagnostic | conditionner `if (process.env.NODE_ENV !== 'production')` | ~10 % |

Outils :
- `lib/logger.ts` à créer (wrapper léger autour de `console`)
- API : `logger.info(scope, msg, data?)`, `logger.warn`, `logger.error`

## Sous-phase C — Refactor 500-1500 lignes (NON livré cette session)

25 fichiers candidats, par taille :

| Lignes | Fichier | Note refactor |
|---|---|---|
| 1791 | app/admin/import/page.tsx | gros — multi-tab import POI |
| 1650 | app/dashboard/iris-crawler/page.tsx | crawler IRIS multi-step |
| 1526 | app/admin/carreaux-import/page.tsx | shapefile/parquet import |
| 1493 | app/map/_components/CorrelationPanel.tsx | analyse corrélation |
| 1253 | components/CoverageResultsPanel.tsx | charts couverture démo |
| 1253 | components/ClusterDetails.tsx | détail cluster |
| 1114 | app/integration-panneaux/page.tsx | import panneaux |
| 1061 | app/map/_components/ClusterPanel.tsx | panel cluster |
| 962 | app/copilote/_hooks/useMapLayers.ts | hook MapLibre layers |
| 952 | app/copilote/_hooks/useMapInit.ts | init MapLibre |
| 916 | app/admin/radio/page.tsx | back-office radio |
| 882 | app/admin/campaigns/page.tsx | back-office campaigns |
| 877 | components/ClusteringPDFReport.tsx | PDF export |
| 850 | app/copilote/_components/ChatPanel.tsx | chat copilote |
| 816 | app/map/_components/ClusteringWizard.tsx | wizard clustering |
| 796 | app/admin/filosofi-import/page.tsx | import filosofi |
| 735 | components/digital/AnalyseV2.tsx | analyse V2 (déjà cleané phase A4.5) |
| 720 | app/map/analyse/digital/page.tsx | digital analysis main |
| 693 | app/map/_components/ScoringPanel.tsx | panel scoring |
| 687 | app/admin/organizations/[id]/page.tsx | back-office org |
| 655 | app/copilote/_components/MapPanel.tsx | map panel copilote |
| 577 | components/custom-geo/CustomGeoCaptureModal.tsx | modal capture |
| 535 | app/admin/health/page.tsx | health check page |
| 533 | lib/radio/radio-matcher.ts | matcher radio |
| 518 | app/map/_components/StudyDashboard.tsx | dashboard study |

Stratégie pour chacun (à appliquer en session dédiée) :
- Identifier les **sections logiques** (state / handlers / UI sub-sections / hooks / types)
- Extraire vers `_components/` ou `hooks/` ou `_lib/`
- 1 extraction → smoke E2E → commit
- Smoke E2E **manuel par Vince** car Claude Code n'a pas browser fiable

**Reporté à session dédiée — risque modéré, exige validation manuelle continue.**

## Sous-phase D — 3 monstres > 2000 lignes (DOC + cleanup interne)

| Lignes | Fichier | Action |
|---|---|---|
| 3789 | app/map/_components/FilterPanel.tsx | JSDoc en-tête + cleanup any/console.log |
| 2831 | app/admin/sources/page.tsx | JSDoc en-tête + cleanup any/console.log |
| 2329 | app/map/page.tsx | JSDoc en-tête + cleanup any/console.log |

Plan livraison :
- `docs/known_tech_debt.md` créé avec les 3 fichiers
- JSDoc en-tête sur chacun (sections internes documentées)
- Cleanup any/console.log à l'intérieur (cf sous-phases A et B)

## Plan de livraison cette session

1. ✅ Phase 0 — ce fichier
2. ⏭️ Sous-phase A — bulk replace `any` → typage strict (≤ 20 justifiés)
3. ⏭️ Sous-phase B — `lib/logger.ts` + replace 149 console.log
4. ⏭️ Sous-phase D — `docs/known_tech_debt.md` + JSDoc 3 fichiers
5. ❌ Sous-phase C — **REPORTÉ session dédiée** (refactor 500-1500 = risque modéré, ~6-8h, smoke E2E manuel obligatoire entre chaque extraction)
