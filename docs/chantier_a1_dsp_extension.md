# Chantier A1 — Extension `dsp_campaign_data` + tables de mapping flexible

> Migration appliquée : `dsp_data_extension_chantier_a1` (2026-04-28)
> Fichier SQL : `supabase/migrations/20260428_dsp_data_extension_chantier_a1.sql`
> Décision produit : `ETAT_DES_LIEUX_DSP_PILOT.md` — rester sur le legacy `public.dsp_campaign_data`, étendre plutôt que créer un schéma `dsp_pilot.*` séparé.

---

## 1 — Colonnes ajoutées

### `public.dsp_campaign_data` (NULLABLE / DEFAULT, +5 colonnes)

| Colonne | Type | Default | Rôle |
|---------|------|---------|------|
| `impressions` | `BIGINT` | NULL | Impressions natives DSP (TTD/DV360/Meta…) |
| `clicks` | `INT` | NULL | Clics DSP (NULL sur Adform legacy) |
| `spend` | `NUMERIC(12,4)` | NULL | Dépense € HT post ad-tech fees |
| `metrics` | `JSONB` | `'{}'::jsonb` | KPIs étendus (viewable, leads, visits, bid_*, video_completions, unique_users…) |
| `dsp_source` | `TEXT` | NULL | DSP source de la ligne (redondant avec `dsp_campaigns.dsp_source` pour requêtes directes) |

### `public.dsp_campaigns` (NULLABLE / DEFAULT, +5 colonnes)

| Colonne | Type | Default | Rôle |
|---------|------|---------|------|
| `kpi_primary` | `TEXT` | NULL | Validé contre `dsp_metrics_registry.field` |
| `kpi_target` | `NUMERIC` | NULL | Valeur cible du KPI primary |
| `geo_strategy` | `JSONB` | `'{}'::jsonb` | Stratégie géo planner |
| `total_budget` | `NUMERIC(12,2)` | NULL | Budget campagne |
| `currency` | `TEXT` | `'EUR'` | ISO 4217 |

### Indexes ajoutés

- `idx_dsp_data_metrics_gin` — GIN sur `metrics` (lookups `WHERE metrics->>'leads'`)
- `idx_dsp_data_source` — partiel sur `dsp_source IS NOT NULL`
- `idx_dsp_data_impressions` — partiel `(campaign_id, date) WHERE impressions IS NOT NULL`
- `idx_source_mappings_dsp` — sur `dsp_source_mappings(dsp_source)`
- `idx_metrics_registry_enabled` — partiel `WHERE is_enabled = true`

---

## 2 — Schéma des 2 nouvelles tables

```
┌─────────────────────────────────────────┐  ┌──────────────────────────────────────┐
│ public.dsp_source_mappings              │  │ public.dsp_metrics_registry          │
├─────────────────────────────────────────┤  ├──────────────────────────────────────┤
│ id                  UUID PK             │  │ field                  TEXT PK       │
│ dsp_source          TEXT NOT NULL       │  │ display_name           TEXT NOT NULL │
│ source_column       TEXT NOT NULL       │  │ display_name_fr        TEXT          │
│ target_field        TEXT NOT NULL       │  │ unit                   TEXT          │
│ target_location     core|metrics|dim    │  │ description            TEXT          │
│ data_type           int|bigint|num|...  │  │ is_core                BOOL DEF false│
│ transform           TEXT                │  │ is_kpi_eligible        BOOL DEF true │
│ is_required         BOOL DEF false      │  │ optimization_direction maximize|min  │
│ display_order       INT DEF 0           │  │ display_order          INT DEF 0     │
│ notes               TEXT                │  │ is_enabled             BOOL DEF true │
│ created_at          TIMESTAMPTZ         │  │ is_legacy              BOOL DEF false│
│ updated_at          TIMESTAMPTZ         │  │ created_at             TIMESTAMPTZ   │
│ UNIQUE(dsp_source, source_column)       │  │ updated_at             TIMESTAMPTZ   │
└─────────────────────────────────────────┘  └──────────────────────────────────────┘
        ▲                                              ▲
        │                                              │
        │ alimente le parser CSV/XLSX                  │ drive les dropdowns frontend
        │ /api/admin/campaigns/import (chantier A2)    │ (sélection KPI primary, axes, etc.)
        │                                              │
       Client UI : ajouter un nouveau DSP / KPI = INSERT, sans déploiement.
```

### RLS (pattern GEOMATIK)

| Table | Policy SELECT | Policy ALL (write) |
|-------|---------------|--------------------|
| `dsp_source_mappings` | `authenticated USING (true)` | `get_user_role() = ANY (ARRAY['super_admin','admin'])` |
| `dsp_metrics_registry` | `authenticated USING (true)` | `get_user_role() = ANY (ARRAY['super_admin','admin'])` |

Triggers `BEFORE UPDATE … set_updated_at()` posés sur les deux tables.

---

## 3 — Seeds initiaux

### 3a — `dsp_metrics_registry` (12 KPIs)

| field | core | kpi_eligible | direction | order | legacy |
|-------|------|--------------|-----------|-------|--------|
| `impressions` | ✓ | ✓ | maximize | 10 | |
| `clicks` | ✓ | ✓ | maximize | 20 | |
| `spend` | ✓ | ✓ | minimize | 30 | |
| `viewable_impressions` | | ✓ | maximize | 40 | |
| `unique_users` | | ✓ | maximize | 50 | |
| `bid_requests` | | | — | 60 | |
| `bid_won` | | | — | 70 | |
| `video_completions` | | ✓ | maximize | 80 | |
| `visits` | | ✓ | maximize | 90 | |
| `leads` | | ✓ | maximize | 100 | |
| `tracked_ads` | ✓ | ✓ | maximize | 200 | ✓ |
| `unique_impressions` | ✓ | | maximize | 210 | ✓ |

### 3b — `dsp_source_mappings` TTD (18 colonnes)

| source_column | target_field | target_location | data_type | required |
|---------------|--------------|------------------|-----------|----------|
| `campaign_id` | `external_campaign_id` | dimension | text | ✓ |
| `campaign_name` | `campaign_name` | dimension | text | |
| `date` | `date` | core | date | ✓ |
| `country_code` | `country` | core | text (upper) | ✓ |
| `postal_code` | `postal_code` | core | text (trim) | ✓ |
| `impressions` | `impressions` | core | bigint | ✓ |
| `clicks` | `clicks` | core | int | ✓ |
| `spend` | `spend` | core | numeric | ✓ |
| `bid_requests` | `bid_requests` | metrics | bigint | |
| `bid_won` | `bid_won` | metrics | bigint | |
| `viewable_impressions` | `viewable_impressions` | metrics | bigint | |
| `unique_users` | `unique_users` | metrics | bigint | |
| `video_completions` | `video_completions` | metrics | int | |
| `visits` | `visits` | metrics | int | |
| `leads` | `leads` | metrics | int | |
| `creative_id` | `creative_id` | dimension | text | |
| `device_type` | `device_type` | dimension | text (lower) | |
| `format` | `format` | dimension | text (lower) | |

### 3c — `dsp_source_mappings` Adform (10 colonnes, transposé de `lib/campaigns/column-mappings.ts`)

| source_column | target_field | target_location | data_type | required |
|---------------|--------------|------------------|-----------|----------|
| `campaign` | `campaign_name` | dimension | text | |
| `date` | `date` | core | date | ✓ |
| `city` | `city` | dimension | text | |
| `country` | `country` | core | text | ✓ |
| `postal code` | `postal_code` | core | text (trim) | ✓ |
| `region` | `region` | dimension | text | |
| `dma region` | `dma_region` | dimension | text | |
| `tracked ads` | `tracked_ads` | core | bigint | ✓ |
| `media` | `media` | dimension | text | |
| `unique impressions` | `unique_impressions` | core | bigint | |

### Mappings non seedés (fallback Adform vide dans `column-mappings.ts`)

`DSP_MAPPINGS` ne contient que `adform`. Les autres DSP du dropdown (`dv360`, `xandr`, `amazon_dsp`, `meta`, `tiktok`, `other`) tombent en fallback Adform via `getMappingForSource()`. **À compléter manuellement** au moment où ces DSP seront réellement utilisés (chantier A2 ou seeds additionnels).

---

## 4 — Procédures opérationnelles

### Ajouter un nouveau DSP (ex : DV360)

```sql
INSERT INTO public.dsp_source_mappings
  (dsp_source, source_column, target_field, target_location, data_type, transform, is_required, display_order, notes)
VALUES
  ('dv360', 'Date',                     'date',                 'core',      'date',    'parse_eu_date', true,  10, 'YYYY-MM-DD ou DD/MM/YYYY'),
  ('dv360', 'Country/Region',           'country',              'core',      'text',    'trim',          true,  20, NULL),
  ('dv360', 'Postal Code',              'postal_code',          'core',      'text',    'trim',          true,  30, NULL),
  ('dv360', 'Impressions',              'impressions',          'core',      'bigint',  NULL,            true,  40, NULL),
  ('dv360', 'Clicks',                   'clicks',               'core',      'int',     NULL,            true,  50, NULL),
  ('dv360', 'Revenue (Adv Currency)',   'spend',                'core',      'numeric', NULL,            true,  60, '€ HT'),
  ('dv360', 'Active View: Viewable Impressions', 'viewable_impressions', 'metrics', 'bigint', NULL,      false, 70, NULL),
  ('dv360', 'Total Conversions',        'leads',                'metrics',   'int',     NULL,            false, 80, NULL);
-- Le parser (chantier A2) lit cette table et applique automatiquement les mappings.
-- Aucun déploiement nécessaire.
```

### Ajouter un nouveau KPI (ex : `cpa`)

```sql
INSERT INTO public.dsp_metrics_registry
  (field, display_name, display_name_fr, unit, description, is_core, is_kpi_eligible, optimization_direction, display_order, is_legacy)
VALUES
  ('cpa', 'CPA', 'Coût par acquisition', 'currency_eur',
   'Spend / leads. Calculé à la volée côté frontend.',
   false, true, 'minimize', 110, false);
```

> Pour un KPI **calculé** (ratio comme CPA, ROAS, CTR), `is_core = false` même s'il dérive de colonnes natives — le calcul se fait côté UI ou dans une RPC ad-hoc, pas en colonne stockée.

### Désactiver un KPI sans le supprimer

```sql
UPDATE public.dsp_metrics_registry
SET is_enabled = false
WHERE field = 'bid_requests';
-- L'index partiel idx_metrics_registry_enabled évite que ces lignes polluent les dropdowns.
```

---

## 5 — Adform legacy : état après migration

| Vérification | Avant | Après |
|--------------|-------|-------|
| `public.dsp_campaigns` count | 4 | 4 |
| `public.dsp_campaign_data` count | 294 135 | 294 135 |
| `SUM(tracked_ads)` | 172 056 383 | 172 056 383 |
| Nouvelles colonnes (`impressions`, `clicks`, `spend`, `dsp_source`) | — | NULL × 294 135 |
| `metrics` JSONB | — | `{}` × 294 135 |

Le legacy Adform est **strictement intact**. Les valeurs `tracked_ads` et `unique_impressions` continuent d'être lues sans modification par les 12 RPCs production listées dans la zone interdite du PROMPT.

---

## 6 — Vérifications post-migration (V1-V8)

| Vérif | Description | Résultat |
|-------|-------------|----------|
| V1 | Colonnes ajoutées sur `dsp_campaign_data` | ✅ 5/5 (clicks, dsp_source, impressions, metrics, spend) |
| V1bis | Colonnes ajoutées sur `dsp_campaigns` | ✅ 5/5 (currency, geo_strategy, kpi_primary, kpi_target, total_budget) |
| V2 | 2 nouvelles tables présentes | ✅ `dsp_metrics_registry`, `dsp_source_mappings` |
| V3 | Seeds appliqués | ✅ 12 KPIs / 18 mappings TTD / 10 mappings Adform |
| V4 | RLS active sur les 2 nouvelles tables | ✅ `rowsecurity = true` |
| V5 | Adform legacy intact | ✅ 294 135 / 4 / SUM=172 056 383 / 294 135 NULL sur nouvelles colonnes |
| V6 | RPC `aggregate_dsp_by_custom_zone` fonctionnelle | ✅ Retour `{zones: [...], summary: {...}}` avec `total_impressions: 1 554 311` |
| V7 | 7 RPCs critiques (`get_campaign_medias`, `get_dsp_campaign_stats`, `get_digital_campaigns_list`, `get_digital_campaign_bbox`, `get_digital_campaign_map`, `get_digital_analysis_breakdown`, `get_digital_media_heatmap`) | ✅ Retour `array`/`object` valide pour chacune |
| V8 | E2E JSONB : insert TTD / read / cleanup | ✅ `impressions=10000`, `clicks=50`, `spend=25.5`, `metrics->>'leads'=2`, `viewable=8500` ; cleanup OK, count revient à 294 135 |

---

## 7 — Hors-scope (chantier A2 et suivants)

- **Pas modifié** : `lib/campaigns/column-mappings.ts` (le parser continue à utiliser le mapping en dur). La refacto pour lire `dsp_source_mappings` à la place sera le chantier **A2**.
- **Pas modifié** : routes API `/api/admin/campaigns/*`, composants `app/admin/campaigns/*` et `app/map/analyse/digital/*`.
- **Pas modifié** : 12 RPCs production listées dans la zone interdite.
- **Pas modifié** : `BiddingCopilot` (chat Gemini) — utilisé en l'état.

---

## 8 — Auto-review (Phase 5)

| Critère | Statut |
|---------|--------|
| ✅ Aucun enum hardcodé pour DSP / KPIs | OK — tout en table |
| ✅ Toutes les colonnes ajoutées NULLABLE ou DEFAULT explicite | OK |
| ✅ Aucun `dsp_pilot.*` mentionné dans la migration | OK |
| ✅ Aucune RPC production modifiée | OK |
| ✅ Aucun fichier de la zone forbidden touché | OK |
| ✅ RLS pattern aligné sur GEOMATIK (`get_user_role()`) | OK (PROMPT mentionnait `auth.jwt()`, alignement vers le pattern réel observé) |
| ✅ Trigger `set_updated_at` réutilisé (pas de duplication) | OK |
