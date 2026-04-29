# Chantier A4.4 — UI pitch Custom Bidding

> Date : 2026-04-29
> Statut : livré, vérifié en navigateur

## Résumé exécutif

Page `/custom-bidding/[strategyId]` qui visualise l'impact des bid_multipliers générés par Hoeffding (chantiers A4.1-A4.3) sur la stratégie démo Renault Captur. Le planner dispose d'un :
- Header avec selector `execution_mode` (auto/suggest/monitor) + 3 boutons d'action (predict/train/detect-drift)
- 4 KPI delta cards (leads sim. vs réel, lift global, CPL, spend)
- 2 cartes MapLibre côte à côte (réel observé vs simulation contrefactuelle)
- Bouton play day-by-day avec slider de date + 4 vitesses (1×/2×/5×/10×)
- Marqueurs drift events sur le slider et la timeline
- Timeline Recharts (courbes leads réel vs simulé) avec curseur synchronisé

## Fichiers livrés

```
supabase/migrations/20260429_a4_4_get_strategy_comparison_data.sql

app/api/bidding/strategies/
├── route.ts                              # GET liste stratégies + jointure campaign
└── [id]/
    ├── route.ts                          # GET/PATCH meta + execution_mode
    ├── comparison/route.ts               # GET RPC get_strategy_comparison_data
    ├── playback/route.ts                 # GET agrégat journalier
    └── drift-events/route.ts             # GET drifts par stratégie

lib/bidding-ml/
└── comparison.ts                         # aggregateByDate / aggregateByZone / computeGlobalKpis

app/custom-bidding/
├── page.tsx                              # Liste stratégies
└── [strategyId]/
    ├── page.tsx                          # Page détail orchestratrice
    └── _components/
        ├── StrategyHeader.tsx
        ├── KpiDeltaCards.tsx
        ├── PlayControls.tsx
        ├── ChoroplethSplit.tsx
        └── ComparisonTimeline.tsx

app/admin/campaigns/[id]/page.tsx         # +bouton "Voir la stratégie" si stratégie active
```

## Architecture data flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│  /custom-bidding/[strategyId]/page.tsx                                  │
│                                                                         │
│  Mount → 4 fetches parallèles :                                         │
│    • /api/bidding/strategies/[id]              → strategy + campaign    │
│    • /api/bidding/strategies/[id]/comparison   → 4078 rows (1 mois)     │
│    • /api/bidding/strategies/[id]/drift-events → drifts de la stratégie │
│    • /api/digital/codes-postaux                → 6051 polygons FR       │
│                                                                         │
│  State :                                                                │
│    • allDates (30 jours)                                                │
│    • currentIndex (slider)                                              │
│    • daily series (cumul mois → timeline)                               │
│    • rowsCurrentDay (filtré)                                            │
│    • enrichedGeoJSON (postal_codes × valeurs du jour courant)           │
│                                                                         │
│  Render :                                                               │
│    StrategyHeader │ KpiDeltaCards │ PlayControls                        │
│    ChoroplethSplit (2× SyncMap synchronisés)                            │
│    ComparisonTimeline (Recharts LineChart + ReferenceLine)              │
└─────────────────────────────────────────────────────────────────────────┘
```

## Décisions techniques

### 1. Réutilisation maximale des composants existants
- **`SyncMap`** (Module Campagne Média) instancié 2× avec sync bi-directionnel via state parent
- **`PALETTES` + `buildFillExpression`** réutilisés tels quels (palette teal séquentielle)
- **`adminFetch`** standard pour toutes les routes

### 2. Workaround race condition SyncMap
SyncMap appelle `setData(geojson)` dans un useEffect, mais la source MapLibre n'est créée qu'après l'event `'load'` du basemap (1-3s typiquement). Si le geojson arrive avant load, l'effet skip silencieusement.

→ `ChoroplethSplit` publie le geojson en 3 vagues (350ms / 1500ms / 3000ms) avec une nouvelle référence d'objet à chaque fois. Au moins une vague atterrit après load. Hack temporaire — un fix propre côté SyncMap (écouter 'load' pour retry) viendrait via une PR séparée hors scope A4.4.

### 3. Modèle de simulation linéaire
RPC `get_strategy_comparison_data` calcule `x_sim = x_real * bid_multiplier` ligne par ligne (modèle hérité du benchmark A4.2). Approximation contrefactuelle — limite explicitée dans le footer de la page.

### 4. KPI primary dérivé de l'objective
Pas de colonne hardcoded `bidding_strategies.kpi_primary` ; on lit `bidding_objectives.required_metrics[0]` (= `'leads'` pour la démo) côté frontend.

## Tests E2E vérifiés

| Test | Résultat |
|---|---|
| **T1** Liste affiche les 2 stratégies démo avec badge "demo data" | ✅ |
| **T2** Page détail charge et rend les 5 sections (header, KPIs, controls, maps, timeline) | ✅ |
| **T3** Toggle execution_mode (PATCH, persisté en base, refresh OK) | ✅ |
| **T4** Bouton "Lancer l'algo" appelle Modal et refresh la comparaison | ✅ (Modal joignable) |
| **T5** Play 1×/2×/5×/10× déplace le slider, les KPIs et la carte se mettent à jour | ✅ |
| **T6** Adform legacy strict : 4 / 294 135 / 172 056 383 / 0 stratégies Adform | ✅ |
| **T7** Module Campagne Média : `/admin/campaigns/[id]` non régressé, lien "Voir la stratégie" affiché conditionnellement | ✅ |

## Délivrables

- 1 migration RPC : `get_strategy_comparison_data`
- 5 routes API : `strategies/`, `strategies/[id]`, `/comparison`, `/playback`, `/drift-events`
- 2 pages : `/custom-bidding`, `/custom-bidding/[strategyId]`
- 5 composants UI + 1 helper TS (`comparison.ts`)
- 1 patch dans `app/admin/campaigns/[id]/page.tsx` (lien "Voir la stratégie")
- Documentation (ce fichier)

## Limites connues

- **Race SyncMap** : workaround par 3 vagues setData (350/1500/3000ms). Robuste mais inélégant — à fixer côté SyncMap dans un chantier dédié si le hack devient gênant.
- **Modèle linéaire** : l'extrapolation `leads_sim = leads_real × multiplier` ne capture pas les courbes de saturation. Pour le pitch c'est OK ; documenté en footer.
- **Annotations drift en popup** : marqueurs visuels sur slider + timeline OK ; pas de toast contextualisé au moment où le slider passe sur un drift event (peut être ajouté en A4.5 avec l'agent LLM).
- **2e stratégie démo** : `TEST_E2E_A4_1` est en mode `suggest` mais sans modèle actif → la page la liste mais le clic affichera "Aucun modèle actif". À cleaner en base ou créer un model state pour elle.
