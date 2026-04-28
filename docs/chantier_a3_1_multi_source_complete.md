# Chantier A3.1 — Multi-source viz complète : RPCs v2 + KpiSelector

> Suite et complément d'A3. Le toggle binaire legacy `impressions/unique` est remplacé
> par un `KpiSelector` global ; la choroplèthe / heatmap / breakdown utilisent les
> RPCs `_v2` paramétrées par `metric_field`.

---

## 1 — Architecture finale du flow KPI

```
Page /map/analyse/digital
  │
  ├── const [metric, setMetric] = useState('impressions')   ← state local page
  │
  ├── <KpiSelector value={metric} onChange={setMetric} />   ← controlled
  │       │ fetch /api/admin/campaigns/[id]/metrics
  │       │ retourne available[] depuis dsp_metrics_registry
  │
  ├── <CampaignContextBar metric={metric} onMetricChange={setMetric} />
  │       └─ toggle legacy 'impressions/unique' → toujours dispo pour Adform
  │
  ├── <KpiCardsDsp campaignId={...} />   ← cards multi-source A3
  │
  └── useEffect(metric) → fetchMap(...)  ← re-fetch carte sur change
            │
            ▼ /api/digital/[id]/map?metric=<field>
                   │
                   ▼ Routing serveur :
                     - 'unique'                       → unique_impressions (legacy alias)
                     - 'impressions' / '' + Adform    → tracked_ads (legacy alias)
                     - 'impressions' / '' + autre DSP → impressions (vraie colonne native)
                     - autre                          → field tel quel
                   │
                   ▼ get_digital_geography_map_v2(p_campaign_id, ..., p_metric_field)
                          │
                          ▼ SELECT is_core FROM dsp_metrics_registry → core / JSONB
                          ▼ EXECUTE format(SUM(%s)) où %s = dcd.<col> ou ((dcd.metrics->>'X')::numeric)
```

---

## 2 — Nouvelles RPCs v2

| RPC | Signature | Différence vs v1 |
|-----|-----------|--------------------|
| `get_digital_geography_map_v2` | + `p_metric_field text DEFAULT 'tracked_ads'` | Lookup `dsp_metrics_registry`, construction dynamique `imp_expr` via `format(%I)` (core) ou `format(%L)` (JSONB), `RAISE EXCEPTION` si metric inconnu |
| `get_digital_media_heatmap_v2` | idem | idem |
| `get_digital_analysis_breakdown_v2` | idem | idem |

**Validation contre injection SQL** : tous les fields passés via `format('%I')` (identifier quoting) ou `format('%L')` (literal). Le metric_field doit exister dans `dsp_metrics_registry` (sinon `RAISE EXCEPTION '22023'`). Aucune concaténation directe de string utilisateur.

**Smoke-test post-migration** : v1(metric='impressions') ≡ v2(metric_field='tracked_ads') sur Adform — strictement égaux (3/3 RPCs testés).

---

## 3 — Routes API mises à jour

| Route | Changement |
|-------|------------|
| `/api/digital/[id]/map` | Bascule v1→v2 avec aliasing 'impressions'/'' selon `dsp_source`. Adform → tracked_ads ; autre DSP → impressions natif |
| `/api/digital/[id]/analysis?type=heatmap` | Idem (v1→v2 avec aliasing) |
| `/api/digital/[id]/analysis?type=breakdown` | Idem (v1→v2 avec aliasing) |

**Compat URL bookmark** : `?metric=impressions` continue à fonctionner (alias) ; nouveaux KPIs (`?metric=leads`, `?metric=spend`, …) routés en v2.

---

## 4 — Composants frontend

### Nouveau

- `app/map/analyse/digital/_components/KpiSelector.tsx` — Dropdown controlled (value/onChange), charge available KPIs depuis `/api/admin/campaigns/[id]/metrics`
- `lib/metrics-display/useSelectedMetric.ts` — Hook URL-bound (réservé pour usage futur ; non utilisé en V1 à cause d'un comportement de re-render Next 14 useSearchParams)

### Élargis

Le type `'impressions' | 'unique'` a été élargi à `string` dans **14 fichiers** :
- `app/map/analyse/digital/page.tsx`
- `app/map/analyse/digital/_lib/use-digital-data.ts`
- `app/map/analyse/digital/_components/{ActionListTable, AnalysisPanel, BiddingCopilot, BreakdownChart, CampaignContextBar, KpiSummary, MediaHeatmap, RailroadPipeline}.tsx`
- `components/digital/{AnalyseV2, AnalysisPanelSwitch, TripleMapView}.tsx`
- `app/api/digital/[campaignId]/bidding-chat/route.ts`

L'élargissement est rétro-compatible : `'impressions'` et `'unique'` restent assignables à `string`, et le toggle legacy CampaignContextBar continue à émettre ces valeurs (alias résolus côté serveur).

### Modifications page principale

- `app/map/analyse/digital/page.tsx` :
  - State `metric: string` (defaut `'impressions'` = alias legacy)
  - `<KpiSelector value={metric} onChange={setMetric} />` au-dessus des cards
  - `useEffect [metric]` qui rappelle `fetchMap` quand le KPI change
  - Hook lift : suppression de la normalisation `metric === 'unique' ? 'unique' : 'impressions'` dans `use-digital-data.ts:99` qui transformait tout en alias legacy (BUG bloquant le multi-KPI sur le client)

---

## 5 — Procédure : ajouter un nouveau KPI affichable de bout en bout

### Étape 1 — INSERT dans le registry

```sql
INSERT INTO public.dsp_metrics_registry
  (field, display_name, display_name_fr, unit, description,
   is_core, is_kpi_eligible, optimization_direction, display_order)
VALUES
  ('roas', 'ROAS', 'ROAS', 'rate', 'Return on Ad Spend = revenue/spend',
   false, true, 'maximize', 110);
```

### Étape 2 — INSERT mappings DSP (si nouveau parser de fichier)

```sql
INSERT INTO public.dsp_source_mappings
  (dsp_source, source_column, target_field, target_location, data_type, transform, is_required, display_order, notes)
VALUES
  ('ttd', 'roas', 'roas', 'metrics', 'numeric', NULL, false, 130, NULL);
```

### Étape 3 — Importer une campagne

L'import standard `/admin/campaigns` parse la colonne `roas` du CSV TTD et l'écrit dans `metrics->'roas'` (JSONB).

### Étape 4 — Visualisation

`/map/analyse/digital` sur cette campagne :
- Le `KpiSelector` propose automatiquement « ROAS » dans la liste (après expiration cache 5 min ou rechargement)
- Sélectionner « ROAS » → carte / cards / heatmap / breakdown se mettent à jour
- Les RPCs v2 lisent `dsp_metrics_registry` à chaque appel pour valider et construire l'`imp_expr` SQL

**Aucun déploiement frontend nécessaire.**

---

## 6 — Tests E2E réalisés

| Test | Scénario | Résultat |
|------|----------|----------|
| **T1 Non-régression Adform** | Campagne TF1 MAR (`f60c8e59…`) | ✅ KpiSelector = « Ads trackées (legacy) » ; 86 949 839 ads trackées (= total v1) ; carte choroplèthe identique au pré-A3.1 |
| **T2 TTD multi-KPI** | Campagne `A3_1 TEST TTD` (60 lignes générées avec 3 médias × 20 CPs) | ✅ 8 options dans le KpiSelector (Impressions/Clics/Dépense/Impressions visibles/Bid requests/Bids gagnés/Visites/Leads). Switch Impressions → Leads ⇒ network `metric=leads`, carte Ratio repeinte (IDF rouge sur-servi), bandeau total `313 imp.` (= 313 leads) |
| **T3 Aucun toggle hardcoded** | `grep "'impressions' \| 'unique'"` dans `app/` `components/` | ✅ 0 résultat (élargi à `string` partout) |
| **T4 Smoke-test SQL v1≡v2** | Adform tracked_ads | ✅ 3/3 RPCs strictement identiques (breakdown / heatmap / map) |
| **Non-régression DB** | Volumes après cleanup test | ✅ 4 / 294 135 / SUM(tracked_ads)=172 056 383 |

---

## 7 — Hardcoded résiduels (encore à traiter)

| Fichier | Ligne | Contenu | Stratégie |
|---------|-------|---------|-----------|
| `_components/CampaignContextBar.tsx` | 38, 53, 67 | Ternaires `metric === 'unique' ? 'Imp. uniques' : 'Impressions'` | **À laisser** : toggle legacy fonctionnel pour Adform (résolu serveur). Refacto label → registry hors scope. |
| `_components/KpiSummary.tsx` | 24 | Ternaire idem | Idem |
| `_components/BreakdownChart.tsx` | 41 | Ternaire idem | Idem |
| `_components/MediaHeatmap.tsx` | 76 | Ternaire idem | Idem |

Ces hardcoded sont **fonctionnels** : ils gèrent le cas où le user clique le toggle Impressions/Imp. uniques de CampaignContextBar (Adform legacy). Le serveur résout `metric === 'impressions'` selon le `dsp_source` de la campagne. **Aucun bug** mais les labels ne suivent pas le `dsp_metrics_registry` quand on choisit un KPI moderne — limitation visuelle hors enveloppe A3.1.

Pour éliminer 100 % les hardcoded : remplacer chaque ternaire par un lookup `dsp_metrics_registry` côté composant (chantier UI futur, ~30 min de travail).

---

## 8 — Auto-review (Phase 6)

| Critère | Statut |
|---------|--------|
| ✅ Aucune RPC v1 modifiée | OK — `pg_get_functiondef` v1 inchangée, v2 ajoutées en parallèle |
| ✅ RPCs v2 utilisent `format(%I)` et `%L` correctement | OK — pas d'injection possible (validation registry + quoting) |
| ✅ Validation `metric_field` contre le registry dans chaque RPC | OK — RAISE EXCEPTION '22023' si field inconnu |
| 🟡 Toggle legacy `impressions/unique` complètement supprimé | **Partiellement** : élargi à `string`, mais ternaires labels FR conservés (fonctionnels) |
| ✅ Adform legacy s'affiche identiquement à avant | OK (T1) |
| ✅ adminFetch() pour les routes admin | OK |
| ✅ Aucun Promise.all > 3 concurrent | OK |
| ✅ Pas de France-wide bbox scan introduit | OK |
| ✅ TypeScript clean (hors 3 erreurs pré-existantes) | OK |
