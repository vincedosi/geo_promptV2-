# Chantier A4.7 — Wizard de configuration de stratégie

> Date livraison : 2026-04-30
> Branche : `feat/analyse-v2`
> Commits : 4 atomiques (DB + API + UI + intégration)
> Adform legacy strict (4 / 294 135 / 172 056 383) — non-régression validée

---

## 1. Vue d'ensemble

A4.7 remplace le modal minimaliste `ActivateCustomBidding` (livré en A4.4.5) par un **wizard 5 steps** qui donne au planner le contrôle complet sur sa stratégie de pilotage ML, avec :

- Pondération géographique granulaire (3 modes : uniforme / par tier / par sous-zone)
- Preview stats temps réel
- Autosave en brouillon (debounce 1s, expire 30j)
- Édition post-création + audit trail complet (`strategy_changes`)
- Override d'autonomie agent IA pour la stratégie
- 5 presets d'initialisation (boost_light, focus, exclusive, neutral, custom)

**Principe absolu : RIEN HARDCODÉ.** Algorithmes, objectifs, presets, tiers — tout vient de la DB via des registries pluggables.

---

## 2. Schéma ER

```
                                   ┌─────────────────────────┐
                                   │  bidding_init_presets   │
                                   │  ───────────────────    │
                                   │  code (PK)              │
                                   │  display_name_fr        │
                                   │  in_zone_multiplier     │
                                   │  out_zone_multiplier    │
                                   │  is_default, order      │
                                   └────────────┬────────────┘
                                                │ référencé par init_preset_code
                                                ▼
┌──────────────────────────┐         ┌─────────────────────────────┐
│ bidding_strategy_drafts  │         │     bidding_strategies      │
│ ──────────────────────   │         │     ─────────────────       │
│ id (UUID PK)             │         │  id (UUID PK)               │
│ user_id, campaign_id     │         │  + 23 colonnes A4.7         │
│ current_step (1-5)       │         │  (advertiser, brand,        │
│ draft_data (JSONB)       │         │   inventory_type,           │
│ last_saved_at            │  consume│   weighting_mode,           │
│ expires_at (30j)         │ ──────► │   in_zone_weights JSONB,    │
│ consumed_at, resulting_… │         │   out_zone_weights JSONB,   │
│ UNIQUE(user_id,          │         │   total_budget, currency,   │
│        campaign_id)      │         │   notification_channels,    │
└──────────────────────────┘         │   alert_severity_threshold, │
                                     │   etc.)                     │
                                     └────────────┬────────────────┘
                                                  │ 1:N
                          ┌───────────────────────┼─────────────────────┐
                          ▼                       ▼                     ▼
            ┌───────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐
            │ bidding_zone_configs  │  │ bidding_strategy_    │  │ strategy_changes │
            │ ─────────────────     │  │   subzones           │  │ ──────────────   │
            │  postal_code          │  │ ────────────────     │  │  change_type     │
            │  bid_multiplier       │  │  name, postal_codes  │  │  field_path      │
            │  is_active            │  │  multiplier (0-5)    │  │  old/new_value   │
            │                       │  │  display_order       │  │  reason          │
            │  généré par RPC       │  │                      │  │  triggered_by    │
            │  apply_zone_weights_  │  │  override par CP     │  │  user_id         │
            │  to_strategy()        │  │  dans la zone parent │  │                  │
            └───────────────────────┘  └──────────────────────┘  └──────────────────┘
```

---

## 3. Architecture wizard

```
URL                                    Composant principal
─────────────────────────────────────  ──────────────────────────────────
/strategies/new?campaign=<id>          app/strategies/new/page.tsx
                                       └─ StrategyWizard (mode='create')

/strategies/new?campaign=<id>          app/strategies/new/page.tsx
  &draft=<draft_id>                    └─ StrategyWizard avec initialDraft

/strategies/[id]/edit                  app/strategies/[id]/edit/page.tsx
                                       └─ StrategyWizard (mode='edit')
                                          PATCH au submit + audit trail

/strategies/[id]/history               app/strategies/[id]/history/page.tsx
                                       └─ Liste chronologique des
                                          strategy_changes
```

### Flow client (mode create)

```
1. Page charge → fetch campaign info + draft existant éventuel
2. StrategyWizard se monte avec defaultData() ou initialDraft
3. À chaque modification de draftData :
   useStrategyDraftAutosave (debounce 1s)
   → POST /api/bidding/strategies/drafts (UPSERT user_id+campaign_id)
4. Step 2 : à chaque modif des weights :
   → POST /api/bidding/strategies/preview-weights (debounce 600ms)
   → affiche stats live (n_in_zone, avg_multiplier, budget_share)
5. Step 6 (Récap) → bouton "Activer la stratégie" :
   → POST /api/bidding/strategies (payload complet)
     → INSERT bidding_strategies + INSERT subzones + RPC apply_zone_weights
     → UPSERT agent_autonomy_settings (si override)
     → UPDATE draft consumed_at
     → log_strategy_change(change_type='created')
   → router.push(`/custom-bidding/<new_id>`)
```

### Flow client (mode edit)

```
1. Page charge → fetch GET /api/bidding/strategies/[id] (full + subzones)
2. Reconstruit WizardDraftData depuis colonnes DB → initialDraft
3. StrategyWizard mode='edit' (autosave désactivé)
4. À l'activation :
   → PATCH /api/bidding/strategies/[id] (payload partial)
     → diff JSON avec état actuel
     → 1 strategy_changes row par champ modifié (RPC log_strategy_change)
     → re-run apply_zone_weights_to_strategy si pondération a changé
   → router.push(`/custom-bidding/[id]`)
```

---

## 4. Trois modes de pondération expliqués

### Mode `uniform` (par défaut)
Un seul multiplier dans la zone, un seul multiplier hors de la zone.

**JSONB stocké** :
```json
{
  "in_zone_weights":  { "mode": "uniform", "value": 1.5 },
  "out_zone_weights": { "mode": "uniform", "value": 0.7 }
}
```

**RPC** : `apply_zone_weights_to_strategy()` insère `bid_multiplier=1.5` pour tous les CPs de la zone, `0.7` pour les autres CPs FR.

### Mode `by_tier`
4 multipliers par tier (premium_urban, urban, suburban, rural). La RPC `infer_tier(postal_code)` classe chaque CP en heuristique (75xxx → premium_urban, etc.).

**JSONB stocké** :
```json
{
  "in_zone_weights": {
    "mode": "by_tier",
    "values": {
      "premium_urban": 2.0,
      "urban": 1.5,
      "suburban": 1.0,
      "rural": 0.8
    }
  }
}
```

### Mode `by_subzone`
Définit des sous-zones nommées (ex : "Métropole Rennes" = liste de CPs) avec un multiplier individuel. Les CPs non assignés à une sous-zone reçoivent un multiplier "fallback".

Stockage à 2 niveaux :
- `bidding_strategies.in_zone_weights` : `{ "mode": "by_subzone", "value": <fallback> }`
- `bidding_strategy_subzones` : 1 row par sous-zone avec `(name, postal_codes[], multiplier)`

La RPC `apply_zone_weights_to_strategy()` :
1. Insère le fallback `value` pour tous les CPs in-zone
2. UPDATE override depuis `bidding_strategy_subzones`

### Mode `by_cp_csv` (power user)
Upload d'un CSV `postal_code,multiplier`. Le client parse, stocke un dict, l'envoie en JSONB :

```json
{ "mode": "by_cp_csv", "values": { "75001": 2.5, "75002": 2.3, ... } }
```

---

## 5. Procédure : ajouter un nouveau preset

1. Migration `INSERT INTO bidding_init_presets` :
```sql
INSERT INTO bidding_init_presets (code, display_name, display_name_fr,
  description, description_fr, in_zone_multiplier, out_zone_multiplier,
  is_default, display_order)
VALUES
  ('aggressive', 'Aggressive', 'Agressif',
   'Maximum boost in-zone, exclusion outside',
   'Boost maximum sur la zone, exclusion totale hors zone',
   3.0, 0.0, false, 35);
```
2. Le preset apparaît automatiquement dans `Step5MLAgent.tsx` via `GET /api/bidding/init-presets` (filtre `is_enabled=true`, ordonné par `display_order`).
3. Aucune modif de code nécessaire.

---

## 6. Procédure : ajouter un nouveau mode de pondération

(Ex : `by_polygon` pour géofencing avancé)

1. **DB** : étendre la CHECK constraint sur `bidding_strategies.weighting_mode` :
```sql
ALTER TABLE bidding_strategies
  DROP CONSTRAINT bidding_strategies_weighting_mode_check;
ALTER TABLE bidding_strategies
  ADD CONSTRAINT bidding_strategies_weighting_mode_check
    CHECK (weighting_mode IN ('uniform','by_tier','by_subzone','by_cp_csv','by_polygon'));
```
2. **RPC** : ajouter un branch dans `apply_zone_weights_to_strategy()` pour le nouveau mode.
3. **Types client** : étendre `WeightingMode` dans `lib/strategy-wizard/types.ts`.
4. **UI** : ajouter un sub-component dans `Step2Geography.tsx` similaire à `BySubzoneInput` :
```tsx
{data.weighting_mode === 'by_polygon' && (
  <ByPolygonInput value={data.in_zone_weights} onChange={...} />
)}
```
5. **Defaults** : ajouter dans `switchMode()` la structure JSONB par défaut.

---

## 7. Routes API livrées

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/bidding/strategies` | POST | Création complète (payload wizard 5 steps) |
| `/api/bidding/strategies` | GET | Liste avec advertiser/brand/inventory_type |
| `/api/bidding/strategies/[id]` | GET | Détail + subzones + agent_autonomy_override |
| `/api/bidding/strategies/[id]` | PATCH | Édition champ-par-champ + audit trail |
| `/api/bidding/strategies/[id]` | DELETE | Soft-archive (status='archived') |
| `/api/bidding/strategies/[id]/changes` | GET | Audit trail enrichi user_email |
| `/api/bidding/strategies/drafts` | GET | List user drafts (?campaign_id filter) |
| `/api/bidding/strategies/drafts` | POST | UPSERT (user_id, campaign_id) |
| `/api/bidding/strategies/drafts/[id]` | GET | Load draft (vérif owner) |
| `/api/bidding/strategies/drafts/[id]` | DELETE | Discard draft (vérif owner) |
| `/api/bidding/strategies/preview-weights` | POST | Calcul sans persist + sample features + stats |
| `/api/bidding/init-presets` | GET | 5 presets seedés |
| `/api/custom-geo/[id]/preview` | GET | GeoJSON light pour mini-map wizard |

---

## 8. Tables DB livrées

| Table | Rows | Description |
|-------|------|-------------|
| `bidding_init_presets` | 5 (seedés) | Presets de pondération |
| `bidding_strategy_drafts` | 0 (créés à la volée) | Brouillons autosave 30j |
| `bidding_strategy_subzones` | 0 (créés à la volée) | Sous-zones mode `by_subzone` |
| `strategy_changes` | 0 (audit trail) | Conformité Dentsu/Renault |

ALTER additif sur `bidding_strategies` : 23 colonnes nouvelles (`advertiser`, `brand`, `inventory_type`, `weighting_mode`, `in_zone_weights`, `out_zone_weights`, `total_budget`, `currency`, `kpi_target`, `notification_channels`, `alert_severity_threshold`, etc.).

---

## 9. Tests E2E (T1-T10) — checklist

| # | Test | Statut | Mode |
|---|------|--------|------|
| T1 | Wizard création complet (5 steps + Récap → /custom-bidding) | À valider manuellement | E2E |
| T2 | Autosave brouillon (debounce 1s, reprise après reload) | À valider manuellement | E2E |
| T3 | Édition post-création (modif kpi_target → strategy_changes) | À valider manuellement | E2E |
| T4 | 4 modes de pondération (uniform/by_tier/by_subzone/by_cp_csv) | À valider manuellement | E2E |
| T5 | Preset → override Step 2 | À valider manuellement | E2E |
| T6 | **Adform legacy strict** | ✅ **VALIDÉ** | DB query |
| T7 | Audit trail visualisé (/strategies/[id]/history) | À valider manuellement | E2E |
| T8 | Non-régression Custom Bidding existant | À valider manuellement | E2E |
| T9 | Non-régression Module Campagne Média | À valider manuellement | E2E |
| T10 | Création de zone custom depuis le wizard | Reportée (V2) | E2E |

**T6 — Adform legacy strict** (DB) :
```
adform_count           : 294 135 ✓
adform_tracked_ads_sum : 172 056 383 ✓
adform_strategies_count: 0 ✓
```

**Vérifications statiques** :
- `npx tsc --noEmit` : 0 erreur ✓
- 4 tables A4.7 créées ✓
- 5 presets seedés ✓
- RPC `apply_zone_weights_to_strategy` + `log_strategy_change` + `infer_tier` créées ✓
- 0 modif des 18 RPCs production existantes ✓
- 0 modif des composants A4.4 (ChoroplethSplit, etc.) ✓

---

## 10. Limites connues V1 (à reporter en V2 si besoin)

1. **Pas de mini-map MapLibre dans Step 2** — la preview est limitée aux stats numériques. La feature `PreviewMap.tsx` n'a pas été livrée pour limiter la complexité (MapLibre + features GeoJSON real). Le `sample_features` retourné par `/preview-weights` contient les multipliers mais avec geometry placeholder `[0,0]`.

2. **`infer_tier()` heuristique** — classement basé sur le code postal sans référence INSEE réelle. Précis pour Paris/Lyon/Marseille centre, approximatif sinon. Reportable V2 avec un référentiel `iris.tier`.

3. **Création de zone custom depuis wizard (T10)** — pas de redirect → /zones/new. L'utilisateur doit créer la zone d'abord dans le module Carte → Capture, puis revenir au wizard.

4. **Granularité IRIS** — la colonne `granularity` accepte `'iris'` mais la RPC `apply_zone_weights_to_strategy` ne génère que des `bidding_zone_configs` au niveau postal_code. Migration future.

---

## 11. Commits (4 atomiques)

| SHA | Message |
|-----|---------|
| `dc00d98` | `feat(strategy-db): A4.7 phase 1 — schema for wizard, drafts, audit trail, presets` |
| `365d29c` | `feat(strategy-api): A4.7 phase 2 — 12 endpoints for wizard + drafts + preview` |
| `c8d5ad8` | `feat(strategy-wizard): A4.7 phase 3 — 5-step wizard with autosave + live preview stats` |
| `8222142` | `feat(strategy-edit): A4.7 phase 4 — edit + history + draft banner, remove A4.4.5 modal` |

---

## 12. Vérification finale (post-déploiement)

```bash
npx tsc --noEmit                                    # → 0 erreur ✓
curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:3000/strategies/new?campaign=test  # → 200 ✓
curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:3000/strategies/abc/edit           # → 200 ✓
curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:3000/strategies/abc/history        # → 200 ✓
curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:3000/api/bidding/init-presets      # → 401 (auth requise) ✓
```

```sql
-- Adform legacy strict
SELECT count(*) FROM dsp_campaign_data
WHERE campaign_id IN (SELECT id FROM dsp_campaigns WHERE dsp_source='adform' AND is_demo=false);
-- ATTENDU : 294135 ✓

SELECT count(*) FROM bidding_strategies
WHERE campaign_id IN (SELECT id FROM dsp_campaigns WHERE dsp_source='adform');
-- ATTENDU : 0 (Adform jamais éligible) ✓
```
