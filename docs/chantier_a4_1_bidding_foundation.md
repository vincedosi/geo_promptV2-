# Chantier A4.1 — Custom Bidding : Schéma DB + Seeds + Dataset démo

> Fondation produit du chantier Custom Bidding ML. **Aucune logique ML, aucune UI, aucune RPC métier**
> — juste les tables + les seeds + un dataset démo prêt pour le pitch.

---

## 1 — Schéma ER (8 nouvelles tables + extension `dsp_campaigns`)

```
dsp_campaigns(+is_demo)
   │
   │ 1───n
   ▼
┌──────────────────────┐         ┌──────────────────────┐
│ bidding_strategies   │────────▶│ bidding_algorithms   │
│ (cœur métier)        │   FK    │ (5 algos seedés)     │
│  - scope_type        │         └──────────────────────┘
│  - zone_id ?────────────┐      ┌──────────────────────┐
│  - is_demo           │   │     │ bidding_objectives   │
└──────────────────────┘   │     │ (8 objectifs seedés) │
   │ 1───n     1───n       │     └──────────────────────┘
   │                       │
   ▼                       ▼
┌──────────────────────┐  custom_geo_zones (FK existante)
│ bidding_zone_configs │
│ (bid_multiplier/CP)  │
└──────────────────────┘
   │ 1───n
   ▼
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│ bidding_daily_state  │  │ bidding_simulations  │  │ adaptive_model_state │
│ (perf jour×CP)       │  │ (replay baseline vs  │  │ (versions modèles)   │
│                      │  │  algo)               │  │                      │
└──────────────────────┘  └──────────────────────┘  └──────────────────────┘
                                                       │ 1───n
                                                       ▼
                                              ┌──────────────────────┐
                                              │ bidding_drift_events │
                                              │ (3 démo seedés)      │
                                              └──────────────────────┘
```

### FK et contraintes clés
- `bidding_strategies.campaign_id` → `dsp_campaigns.id` (CASCADE)
- `bidding_strategies.zone_id` → `custom_geo_zones.id` (RESTRICT)
- Contrainte `bs_zone_scope_consistent` : `scope_type='custom_zone'` ⇔ `zone_id IS NOT NULL`
- `adaptive_model_state` : partial unique index `idx_ams_one_active` ⇒ **un seul modèle actif par stratégie**
- `bidding_zone_configs` : UNIQUE (strategy_id, postal_code, country_code)
- `bidding_daily_state` : UNIQUE (strategy_id, postal_code, country_code, date)

### Indexes performance
- `idx_bidding_strats_campaign`, `idx_bidding_strats_status` (partial active/paused), `idx_bidding_strats_demo` (partial)
- `idx_bzc_strategy_active` (partial), `idx_bzc_postal`
- `idx_bds_strategy_date` (DESC), `idx_bds_postal_date` (DESC), `idx_bds_metrics_gin` (GIN JSONB)
- `idx_bsim_strategy` (DESC), `idx_bsim_status` (partial pending/running)
- `idx_bde_strategy`, `idx_bde_unresolved` (partial), `idx_bde_detected` (DESC)

---

## 2 — Algos seedés (5 candidats pour benchmark A4.2)

| code | family | library | online | drift | baseline |
|------|--------|---------|--------|-------|----------|
| `hoeffding_adaptive_tree` | tree | river | ✓ | ✓ | |
| `linucb` | bandit | custom | ✓ | | |
| `thompson_sampling` | bandit | custom | ✓ | | |
| `gbm_online` | tree | river | ✓ | ✓ | |
| `baseline_random` | baseline | custom | | | ✓ |

Configs initiales stockées dans `config_schema` JSONB (cf. seeds A4.1) — chaque algo a ses hyperparams par défaut.

---

## 3 — Objectifs seedés (8 objectifs)

| code | direction | unit | required_metrics | formula |
|------|-----------|------|-------------------|---------|
| `maximize_impressions` | max | count | impressions | — |
| `maximize_viewability` | max | rate | impressions, viewable_impressions | `viewable_impressions / NULLIF(impressions, 0)` |
| `maximize_ctr` | max | rate | impressions, clicks | `clicks / NULLIF(impressions, 0)` |
| `maximize_visits` | max | count | visits | — |
| `maximize_leads` | max | count | leads | — |
| `minimize_cpa` | min | currency_eur | spend, leads | `spend / NULLIF(leads, 0)` |
| `minimize_cpc` | min | currency_eur | spend, clicks | `spend / NULLIF(clicks, 0)` |
| `maximize_roas` | max | rate | spend | (à compléter selon attribution) |

---

## 4 — Dataset démo `Renault Captur — Mars 2026`

**Volumes mesurés** :

| Indicateur | Valeur |
|------------|--------|
| Lignes data importées | **4 078** |
| CPs distincts | **136** |
| Jours distincts | **30** |
| Total `impressions` | **16 474 191** |
| Total `leads` | **7 401** |

**Caractéristiques** :
- 4 tiers de zones : `premium_urban` (13 CPs Paris), `urban` (15), `suburban` (23), `rural` (90)
- Génération SQL déterministe via `setseed(-0.5)` (reproductible)
- Bruit gaussien approximé via somme de 12 random uniformes (Central Limit Theorem)
- **Drift simulé J+15** sur les zones rurales :
  - `drift_factor = 0.85` sur les performances (impressions, leads)
  - `+18 %` sur le CPM (concurrent push)
- KPIs disponibles dans `dsp_campaign_data.metrics` (JSONB) : `bid_requests`, `bid_won`, `viewable_impressions`, `unique_users`, `visits`, `leads`, `tier`
- KPIs natifs : `impressions`, `clicks`, `spend`

**1 stratégie démo** linkée à la campagne :
- `Pitch Demo — Maximize Leads (Hoeffding)` : `algo=hoeffding_adaptive_tree`, `objective=maximize_leads`, `scope=national`, `status=completed`, `is_demo=true`

**3 drift events démo** (cohérents avec le dataset) :
- 2 `performance_drift` medium sur CPs ruraux (01100 le 16/03, 15100 le 17/03)
- 1 `data_drift` low global le 20/03 (baisse `win_rate_rural` -14.78 %)

---

## 5 — Procédure : ajouter un nouvel algo / objectif / drift_type

### Algorithme
```sql
INSERT INTO public.bidding_algorithms
  (code, display_name, display_name_fr, family, library, config_schema,
   supports_drift_detection, supports_online_learning, is_baseline, display_order, description)
VALUES (
  'xgboost_online', 'XGBoost Online', 'XGBoost online',
  'tree', 'river',
  '{"learning_rate":0.05,"max_depth":8}'::jsonb,
  true, true, false, 50,
  'Boosting d''arbres avec adaptation online à drift.'
);
```

### Objectif
```sql
INSERT INTO public.bidding_objectives
  (code, display_name, display_name_fr, optimization_direction, required_metrics, formula, unit, display_order, description)
VALUES (
  'minimize_cpv', 'Minimize CPV', 'Minimiser le CPV', 'minimize',
  '["spend","video_completions"]'::jsonb,
  'spend / NULLIF(video_completions, 0)',
  'currency_eur', 90,
  'Coût par vue vidéo complète.'
);
```

### Drift type
Le champ `drift_type` est libre (`TEXT`) — pas de table de référence. Convention recommandée :
- `performance_drift` : dégradation observée d'un KPI (CPL, CTR, ROAS)
- `data_drift` : changement de distribution des features (win_rate, CPM, viewability)
- `concept_drift` : la relation features → label change (ex: les zones rurales étaient productives, ne le sont plus)

---

## 6 — Vérifications post-migration (V1-V9 toutes vertes)

| V# | Test | Résultat |
|----|------|----------|
| V1 | 8 tables présentes (`bidding_*` + `adaptive_model_state`) | ✅ |
| V2 | `bidding_algorithms`=5, `bidding_objectives`=8 | ✅ |
| V3 | 1 campagne démo + 1 stratégie démo | ✅ |
| V4 | Dataset démo : 4078 rows / 136 CPs / 30 jours / 16.47M imp / 7401 leads | ✅ |
| V5 | 3 drift events démo seedés | ✅ |
| V6 | RLS active sur 8/8 tables | ✅ |
| V7 | Adform legacy intact : 4 / 294 135 / SUM(tracked_ads)=172 056 383 | ✅ |
| V8 | 5 RPCs critiques inchangées (`get_dsp_campaign_stats`, `get_digital_campaigns_list`, `aggregate_campaign_metric` adform/demo, `get_campaign_available_metrics`) | ✅ |
| V9 | E2E cross-jointure : INSERT strategy + zone_config + daily_state + SELECT JOIN + DELETE cascade | ✅ |

---

## 7 — Auto-review (Phase 5)

| Critère | Statut |
|---------|--------|
| ✅ Aucun enum hardcodé pour algos/objectifs/drift_types côté code | OK — tout en table |
| ✅ Toutes les nouvelles colonnes NULLABLE ou DEFAULT explicite | OK |
| ✅ FK vers `custom_geo_zones` cohérente avec le système Custom Geo Capture existant | OK |
| ✅ Aucune RPC modifiée (V8 smoke-test) | OK |
| ✅ Adform legacy strictement intact (V7) | OK |
| ✅ RLS pattern aligné GEOMATIK (`get_user_role()`) | OK — DO $$ block factorisé |
| ✅ Trigger `set_updated_at` réutilisé (pas de duplication) | OK sur `bidding_strategies` et `bidding_zone_configs` |
| ✅ Indexes posés pour les query patterns évidents | OK (campaign FK, status partial, GIN metrics, dates DESC) |

---

## 8 — Hors-scope (chantiers suivants)

- **A4.2** : Benchmark des 5 algos sur le dataset démo (split train/test, métriques, sélection)
- **A4.3** : Backend ML production (RPCs `bid_decide`, `train_model`, `detect_drift`, intégration river/python)
- **A4.4** : UI pitch (toggle Sans/Avec algo, choroplèthe split, bouton play replay, exports DSP)

---

## 9 — Migrations de ce chantier

1. `supabase/migrations/20260428_chantier_a4_1_bidding_foundation.sql` — DDL (8 tables + RLS + is_demo)
2. `supabase/migrations/20260428_chantier_a4_1_seeds_metadata.sql` — Seeds (5 algos + 8 objectives)
3. `supabase/migrations/20260428_chantier_a4_1_demo_dataset.sql` — DO block (campagne + 4078 rows + stratégie + 3 drift events)
