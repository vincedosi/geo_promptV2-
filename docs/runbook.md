# Runbook — opérations courantes MAGELIAN

## Lancer le benchmark Custom Bidding

```bash
cd scripts/benchmarking
.venv\Scripts\activate    # Windows
python test_connection.py  # 3 ✅ attendus
python benchmark_bidding_algos.py
```

Durée ~5 min. Output : 5 rows `adaptive_model_state` + 1 `bidding_simulations` + rapport markdown + 3 PNG.

Cf [`docs/chantier_a4_2_benchmark_results.md`](chantier_a4_2_benchmark_results.md) pour les résultats du benchmark démo.

## Ré-entraîner un modèle Hoeffding

Via UI (page `/custom-bidding/<strategy_id>`, bouton "Ré-entraîner") ou en ligne de commande :

```bash
curl -X POST "$MODAL_BIDDING_ML_URL-train.modal.run" \
  -H "Content-Type: application/json" \
  -d "{\"strategy_id\":\"<uuid>\"}"
```

Effet : nouvelle row `adaptive_model_state` avec `model_version` incrémenté + ancienne désactivée (partial unique index `idx_ams_one_active` garantit unicité).

## Importer une nouvelle campagne DSP

1. Page `/admin/campaigns` (admin uniquement)
2. Bouton "Importer une campagne"
3. Upload CSV/XLSX, choisir DSP source (`ttd`, `dv360`, etc.)
4. Auto-detect mapping colonnes via `dsp_source_mappings`
5. Preview 10 lignes
6. Lancer l'import (SSE streaming, batch par 50)
7. Vérifier en base : `SELECT * FROM dsp_campaign_data WHERE campaign_id = '<id>' LIMIT 5`

## Activer Custom Bidding sur une campagne

1. Aller sur `/map/analyse/digital`
2. Cliquer la campagne (DSP, pas Adform)
3. Sur la page détail : la barre "Optimisez cette campagne par machine learning" s'affiche si éligible
4. Cliquer "Activer Custom Bidding"
5. Modal : nom + algo (Hoeffding par défaut) + objectif + mode (suggest par défaut) → submit
6. Redirige vers `/custom-bidding/<new_strategy_id>`

Cf [`docs/chantier_a4_4_5_ux_integration.md`](chantier_a4_4_5_ux_integration.md).

## Debug un drift event qui n'apparaît pas

```sql
-- 1. Vérifier que des daily_state existent
SELECT COUNT(*), MIN(date), MAX(date) FROM bidding_daily_state
WHERE strategy_id = '<uuid>';

-- 2. Si oui, lancer detect-drift manuellement
-- POST /api/bidding/detect-drift {"strategy_id": "<uuid>"}

-- 3. Vérifier la réponse
SELECT * FROM bidding_drift_events
WHERE strategy_id = '<uuid>'
ORDER BY detected_at DESC LIMIT 5;

-- 4. Si vide : checker les seuils dans modal/bidding_ml/drift_detection.py
-- (CPL_THRESHOLD_MEDIUM = 0.30, CTR_THRESHOLD_MEDIUM = 0.25)
```

## Vérifier l'état de Modal

```bash
curl -X POST "$MODAL_BIDDING_ML_URL-predict.modal.run" \
  -H "Content-Type: application/json" \
  -d '{"strategy_id":"00000000-0000-0000-0000-000000000000"}'
# Attendu : {"error":"Strategy not found","status":404} — pas un timeout
```

Si timeout :
1. Vérifier dashboard Modal (https://modal.com/apps)
2. `modal logs bidding-ml`
3. Re-deploy : `cd modal/bidding_ml && modal deploy app.py`

## Vérifier les quotas Gemini

Via Google AI Studio : https://aistudio.google.com/app/apikey
- Free tier : 60 req/min, 1500 req/jour, 1M tokens/min
- Observé en démo : <100 req/jour total

Si throttling :
- Vérifier rate limiter local : `lib/api/rate-limit.ts` (Upstash si configuré, sinon in-memory)
- Bascule fallback Mistral via `lib/chat/providers.ts` (non implémenté pour agent A4.5 — TODO)

## Audit Adform legacy strict

```sql
SELECT
  (SELECT COUNT(*) FROM dsp_campaigns WHERE is_demo = false) AS adform_campaigns,
  (SELECT COUNT(*) FROM dsp_campaign_data WHERE campaign_id IN (SELECT id FROM dsp_campaigns WHERE is_demo = false)) AS adform_rows,
  (SELECT SUM(tracked_ads) FROM dsp_campaign_data WHERE campaign_id IN (SELECT id FROM dsp_campaigns WHERE is_demo = false)) AS adform_tracked;
-- Attendu : 4 / 294 135 / 172 056 383
```

## Reset stratégie démo Renault Captur

```sql
-- En cas de pollution démo, réinitialiser :
-- ⚠️ NE PAS exécuter en prod réelle
DELETE FROM bidding_zone_configs WHERE strategy_id = '56320afa-a2fb-4915-8b7f-16d52c501c5b';
DELETE FROM bidding_zone_config_proposals WHERE strategy_id = '56320afa-a2fb-4915-8b7f-16d52c501c5b';
DELETE FROM bidding_daily_state WHERE strategy_id = '56320afa-a2fb-4915-8b7f-16d52c501c5b';
DELETE FROM bidding_drift_events WHERE strategy_id = '56320afa-a2fb-4915-8b7f-16d52c501c5b';
DELETE FROM bidding_agent_actions WHERE strategy_id = '56320afa-a2fb-4915-8b7f-16d52c501c5b';
-- Puis re-run benchmark (cf section ci-dessus) et /predict
```

## Vérifier la santé globale

```bash
# Build OK
npm run build

# Type-check OK
npx tsc --noEmit

# Tests OK (lib/prompting)
npm test

# Setup local OK
npx tsx scripts/setup-check.ts
```
