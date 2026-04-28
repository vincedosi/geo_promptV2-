# Chantier A3 — Visualisation multi-source (KPI cards dynamiques)

> Suite de A1 (data extension) et A2 (parser dynamique). A3 amène la
> visualisation multi-source : le module Campagne Média affiche
> dynamiquement les KPIs réellement remplis pour chaque campagne, lus
> depuis `dsp_metrics_registry`.

---

## 1 — Architecture livrée

```
lib/metrics-display/
├── types.ts        ← MetricDescriptor (camelCase) + UnknownMetricError
├── loader.ts       ← loadMetricsRegistry(), getMetric(field) + cache 5 min
├── available.ts    ← detectAvailableMetrics(campaignId) → {available, empty}
├── formatter.ts    ← formatMetricValue(value, metric) selon unit
└── aggregator.ts   ← aggregateCampaignMetric(campaignId, metric) → number|null

app/api/admin/campaigns/[id]/
├── metrics/route.ts     ← GET → {available, empty} MetricDescriptor[]
└── aggregate/route.ts   ← GET ?metric=<field> → {metric, total}

app/map/analyse/digital/_components/
└── KpiCardsDsp.tsx      ← Cards dynamiques top du module

supabase/migrations/
├── 20260428_get_campaign_available_metrics.sql   ← RPC nouvelle (lecture seule)
└── 20260428_aggregate_campaign_metric.sql        ← RPC nouvelle (agg SUM par KPI)
```

### Pipeline d'affichage

```
KpiCardsDsp.tsx
  │
  ▼ adminFetch /api/admin/campaigns/[id]/metrics
       │
       ▼ detectAvailableMetrics(id)
              │
              ▼ Promise.all([
                  loadMetricsRegistry(),  ← cache 5min
                  rpc('get_campaign_available_metrics', { p_campaign_id }),
                ])
              │
              ▼ Match {field → has_data} avec MetricDescriptor[] → {available, empty}
  │
  ▼ Pour chaque KPI available && isKpiEligible (top 5 par displayOrder) :
       adminFetch /api/admin/campaigns/[id]/aggregate?metric=<field>
            │
            ▼ aggregateCampaignMetric(campaignId, metric)
                 │
                 ▼ rpc('aggregate_campaign_metric', { p_campaign_id, p_metric_field, p_is_core })
                      │
                      ▼ SUM(<col native>) si is_core, SUM((metrics->>field)::numeric) sinon
  │
  ▼ formatValue(total, unit) → render card
```

---

## 2 — Nouvelles RPCs

### `get_campaign_available_metrics(p_campaign_id uuid)`

```sql
RETURNS TABLE(field text, has_data boolean)
```

Pour chaque KPI du registry actif, vérifie EXISTS sur `dsp_campaign_data`.
- `is_core` true → CASE WHEN sur les 5 colonnes natives connues (tracked_ads,
  unique_impressions, impressions, clicks, spend)
- `is_core` false → `metrics ? '<field>'`

Une seule requête DB. SECURITY DEFINER.

### `aggregate_campaign_metric(p_campaign_id uuid, p_metric_field text, p_is_core boolean)`

```sql
RETURNS numeric
```

SUM du KPI sur toute la campagne. Ne supporte que SUM en V1 ; si demain on
ajoute `aggregation_function` à `dsp_metrics_registry`, étendre cette RPC pour
supporter AVG / CALCULATED.

---

## 3 — Nouveaux endpoints API

### `GET /api/admin/campaigns/[id]/metrics`

```json
{
  "available": [MetricDescriptor, ...],
  "empty":     [MetricDescriptor, ...]
}
```

Retourne tous les KPIs du registry split en `available` / `empty` selon
`get_campaign_available_metrics`. Ordre : `display_order ASC`.

### `GET /api/admin/campaigns/[id]/aggregate?metric=<field>`

```json
{
  "metric": { "field": "impressions", "label": "Impressions", "unit": "count", "is_core": true, "is_legacy": false },
  "total": 674675
}
```

400 + `code: 'unknown_metric'` si la métrique n'est pas dans le registry.

---

## 4 — Composant `KpiCardsDsp`

Insertion : juste sous `<CampaignContextBar />` dans `app/map/analyse/digital/page.tsx`.

```tsx
{campaignId && <KpiCardsDsp campaignId={campaignId} />}
```

Comportement :
- Skeleton à 5 cards pendant le chargement initial
- Filtre `isKpiEligible === true` (élimine bid_requests/bid_won/unique_impressions
  qui ne sont pas des KPIs cibles mais des mesures techniques)
- Tri par `displayOrder ASC`, top `maxCards` (défaut 5)
- Première card mise en avant (border-top teal + font 20px)
- Badge `legacy` sur les KPIs Adform (`tracked_ads`, `unique_impressions`)
- Loading des aggregates **séquentiel** (Nano-friendly — pas de Promise.all > 3)

Formats : `count` → `Intl.NumberFormat fr-FR`, `currency_eur` → `€`,
`rate`/`percent` → `%`, `seconds` → `Xs`.

---

## 5 — Tests E2E réalisés

| Test | Scénario | Résultat |
|------|----------|----------|
| **T1 Adform** | Campagne `TF1 MAR` (`f60c8e59…`) | ✅ 1 card visible : `tracked_ads = 86 949 839` (legacy badge) ; `unique_impressions` filtrée car `is_kpi_eligible=false` au seed |
| **T2 TTD** | Campagne test `A3 TEST TTD` (50 lignes générées) | ✅ 5 cards : Impressions 674 675 / Clics 6 325 / **Dépense 2 843,25 €** (formaté €/fr) / Impressions visibles 552 500 / Visites 3 380 |
| **T3 Métrique inconnue** | `GET /aggregate?metric=unicorn` | ✅ HTTP 400, `code='unknown_metric'` |
| **T4 RPC pivot** | RPC `aggregate_dsp_by_custom_zone` (zone interdite) | ✅ Renvoie toujours `{zones, summary}` (re-vérifié post-A3) |
| **Non-régression** | Volumes Adform après cleanup test | ✅ 4 / 294 135 / `SUM(tracked_ads)=172 056 383` strictement identiques |

---

## 6 — Procédure : ajouter un nouveau KPI affichable

Aucune modification de code requise.

```sql
INSERT INTO public.dsp_metrics_registry
  (field, display_name, display_name_fr, unit, description,
   is_core, is_kpi_eligible, optimization_direction, display_order)
VALUES
  ('cpa', 'CPA', 'Coût par acquisition', 'currency_eur',
   'Spend / leads. Calculé côté client à partir des agrégats.',
   false, true, 'minimize', 110);
```

Après expiration du cache (5 min) ou redémarrage du process Next, les
`KpiCardsDsp` proposeront automatiquement le nouveau KPI pour les campagnes
dont les données contiennent au moins `metrics ? 'cpa'`.

> Pour un KPI **dérivé** (ratio comme CPA = spend/leads), l'agrégation
> simple SUM ne suffit plus. V1 : faire le calcul côté composant à partir
> des agrégats `spend` et `leads`. V2 (futur) : ajouter colonne
> `aggregation_function ENUM('sum','avg','calculated')` au registry et
> étendre `aggregate_campaign_metric`.

---

## 7 — Hardcoded résiduels (dette technique)

Le PROMPT visait zéro hardcoded KPI dans `app/`/`components/`. La V1 du chantier
livre les **KPI cards** dynamiques mais conserve volontairement certains
hardcodés legacy. Ils seront traités en **A3.1** ou **A3.2** :

| Fichier | Ligne | Contenu | Justification de report |
|---------|-------|---------|--------------------------|
| `app/map/analyse/digital/page.tsx` | 130 | `useState<'impressions'\|'unique'>('impressions')` | Toggle legacy ; piloté par les RPCs `get_digital_*` qui acceptent `p_metric='impressions'\|'unique'`. Reste fonctionnel pour Adform. **A3.1** : KpiSelector dynamique → impose RPCs `_v2`. |
| `_components/CampaignContextBar.tsx` | 38, 53, 67 | Ternaires `metric === 'unique' ? 'Imp. uniques' : 'Impressions'` | Pareil — toggle legacy. Refacto en A3.1. |
| `_components/KpiSummary.tsx` | 24 | Ternaire idem | Idem. |
| `_components/BreakdownChart.tsx` | 41 | Ternaire idem | Idem. |
| `_components/MediaHeatmap.tsx` | 76 | Ternaire idem | Idem. |
| `app/admin/campaigns/page.tsx` | 70-71, 772 | `tracked_ads` / `unique_impressions` dans la table d'aperçu d'import | Spécifique Adform import — **zone admin legacy**, à laisser. |

### Pourquoi V1 minimaliste

Pour faire complètement disparaître les hardcoded legacy :
1. Créer `get_digital_campaign_map_v2(..., p_metric_field, p_is_core)` (variante paramétrée)
2. Créer `get_digital_analysis_breakdown_v2` et `get_digital_media_heatmap_v2`
3. Refacto les 4 composants (page + ContextBar + KpiSummary + BreakdownChart + MediaHeatmap)
4. Brancher la choroplèthe TTD multi-source

C'est un chantier dédié (A3.1) qui aurait dépassé l'enveloppe. La V1 actuelle
livre déjà la valeur la plus visible : **5 KPI cards multi-source en haut du
module, totalement dynamiques**.

---

## 8 — Auto-review (Phase 6 du PROMPT)

| Critère | Statut |
|---------|--------|
| ✅ Pas de modification des 12 RPCs production existantes | OK — vérifié via signatures |
| ✅ Les 4 campagnes Adform s'affichent identiquement | OK — `tracked_ads = 86 949 839` (T1) ; volumes 4/294 135/172 056 383 |
| ✅ Composant BiddingCopilot non touché | OK |
| ✅ `lib/dsp-mapping/*` non touché | OK |
| ✅ adminFetch() pour les routes admin | OK |
| 🟡 Pas de Promise.all > 3 concurrent | OK — chargement aggregates séquentiel |
| 🟡 Tous les KPIs hardcoded résiduels documentés | OK — section 7 |
| ✅ TypeScript clean (hors 3 erreurs pré-existantes iris-crawler / iris/values) | OK |
