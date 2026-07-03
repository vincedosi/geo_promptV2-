# MAGELIAN Bidding ML — Modal service

Service Python serverless qui expose Hoeffding Adaptive Tree (algo gagnant
A4.2) en HTTPS pour le frontend Next.js. Trois endpoints :

- `POST /predict`      — génère les `bid_multiplier` selon `execution_mode`
- `POST /train`        — ré-entraîne sur les N derniers jours et persiste un nouveau `adaptive_model_state`
- `POST /detect-drift` — scanne `bidding_daily_state` et insère des `bidding_drift_events`

L'algo concret est résolu dynamiquement depuis `adaptive_model_state.is_active=true`
via `algos/registry.py` — aucun nom d'algo hardcodé.

---

## Section 1 — Setup local (Vince)

### 1.1 Tokens Modal

```bash
modal token set --token-id ak-... --token-secret as-...
```

(Tokens disponibles sur https://modal.com/settings/tokens.)

### 1.2 Secret Supabase côté Modal

```bash
modal secret create magelian-supabase \
  SUPABASE_URL="https://vkkdbygwbrxyogqosten.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="<service_role_key depuis Supabase Dashboard>"
```

(Secret réutilisé par toutes les fonctions Modal.)

### 1.3 Variables Next.js

Ajouter dans `.env.local` racine du projet :

```
MODAL_TOKEN_ID=ak-xxxxx
MODAL_TOKEN_SECRET=as-xxxxx
MODAL_BIDDING_ML_URL=<URL retournée par modal deploy>
```

Le frontend Next.js appellera `MODAL_BIDDING_ML_URL` en HTTPS.

---

## Section 2 — Déploiement initial

```bash
cd C:\GENESIS\genesis_app
pip install modal
modal deploy modal/bidding_ml/app.py
```

Modal retourne 3 URLs (une par endpoint) :

```
✓ Created web endpoint for predict       => https://<workspace>--bidding-ml-predict.modal.run
✓ Created web endpoint for train         => https://<workspace>--bidding-ml-train.modal.run
✓ Created web endpoint for detect-drift  => https://<workspace>--bidding-ml-detect-drift.modal.run
```

→ Récupérer le **préfixe commun** (sans `-predict.modal.run`) et le mettre
dans `.env.local` sous `MODAL_BIDDING_ML_URL`.

Exemple : `MODAL_BIDDING_ML_URL=https://vincedosis--bidding-ml`

(Le client TypeScript `lib/bidding-ml/client.ts` concatène le suffixe
`-predict.modal.run`, etc.)

---

## Section 3 — Tests E2E (T1-T6)

Ces tests **nécessitent** que Modal soit déployé et que `MODAL_BIDDING_ML_URL`
soit dans `.env.local`. Ils tournent depuis localhost:3000.

### T1 — Mode auto (stratégie démo)

```powershell
$body = @{ strategy_id = "56320afa-a2fb-4915-8b7f-16d52c501c5b" } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3000/api/bidding/predict" `
  -Method Post -Body $body -ContentType "application/json"
```

Attendu : `{ "mode": "auto", "n_predictions": ~136, "n_persisted": ~136 }`. Vérifier en SQL :
```sql
SELECT COUNT(*) FROM bidding_zone_configs
WHERE strategy_id = '56320afa-a2fb-4915-8b7f-16d52c501c5b';
-- ATTENDU : ~136 (un par CP)
```

### T2 — Mode suggest

```sql
-- Préparer une stratégie test
INSERT INTO bidding_strategies (name, campaign_id, algorithm_code, objective_code, execution_mode)
SELECT 'TEST_T2_suggest', campaign_id, algorithm_code, objective_code, 'suggest'
FROM bidding_strategies WHERE is_demo = true AND name LIKE 'Pitch Demo%' LIMIT 1
RETURNING id;

-- Note : il faut aussi cloner le adaptive_model_state actif vers cette nouvelle stratégie
INSERT INTO adaptive_model_state (strategy_id, algorithm_code, model_version, parameters, hyperparameters,
                                   training_window_start, training_window_end, performance_metrics, is_active)
SELECT '<id_T2>', algorithm_code, model_version || '-T2', parameters, hyperparameters,
       training_window_start, training_window_end, performance_metrics, true
FROM adaptive_model_state
WHERE strategy_id = (SELECT id FROM bidding_strategies WHERE is_demo=true AND name LIKE 'Pitch Demo%' LIMIT 1)
  AND is_active = true;
```

Puis appeler `/api/bidding/predict` avec le strategy_id T2. Vérifier :
```sql
SELECT status, COUNT(*) FROM bidding_zone_config_proposals
WHERE strategy_id = '<id_T2>' GROUP BY status;
-- ATTENDU : status=pending, COUNT=~136

SELECT COUNT(*) FROM bidding_zone_configs WHERE strategy_id = '<id_T2>';
-- ATTENDU : 0
```

Approuver une proposition :
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/bidding/proposals/<proposal_id>/approve" -Method Post
```

Vérifier :
```sql
SELECT status, applied_to_config_id FROM bidding_zone_config_proposals WHERE id = '<proposal_id>';
-- ATTENDU : status=applied, applied_to_config_id non NULL

SELECT * FROM bidding_zone_configs WHERE id = '<applied_to_config_id>';
-- ATTENDU : 1 row
```

Cleanup :
```sql
DELETE FROM bidding_strategies WHERE name = 'TEST_T2_suggest';
```

### T3 — Mode monitor_only

Idem T2 mais avec `execution_mode='monitor_only'`. Vérifier :
- `bidding_zone_configs` : 0 row pour cette stratégie
- `bidding_zone_config_proposals` : 0 row
- `bidding_daily_state` : ~136 rows à la date du jour

### T4 — Train

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/bidding/train" `
  -Method Post -Body (@{ strategy_id = "56320afa-..." } | ConvertTo-Json) `
  -ContentType "application/json"
```

Attendu : `{ "model_id": "...", "model_version": "0.2.0-modal-...", "n_train_samples": ~4000 }`.

Vérif : exactement 1 `is_active=true` par stratégie (partial unique index garanti).

### T5 — Drift detection

Insérer un drift artificiel manuel puis :
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/bidding/detect-drift" `
  -Method Post -Body (@{ strategy_id = "56320afa-..." } | ConvertTo-Json) `
  -ContentType "application/json"
```

Attendu : `n_drifts_detected > 0` si drift artificiel inséré, 0 sinon.

### T6 — Adform legacy strict

```sql
SELECT COUNT(*) FROM dsp_campaign_data
WHERE campaign_id IN (SELECT id FROM dsp_campaigns WHERE is_demo = false);
-- ATTENDU : 294135

SELECT SUM(tracked_ads) FROM dsp_campaign_data
WHERE campaign_id IN (SELECT id FROM dsp_campaigns WHERE is_demo = false);
-- ATTENDU : 172056383
```

---

## Section 4 — Mise à jour future

Modifier le code Python local, puis :

```bash
modal deploy modal/bidding_ml/app.py
```

Le déploiement est atomique (l'ancienne version reste active jusqu'au switch).

---

## Section 5 — Ajouter un nouvel algo

1. Créer `modal/bidding_ml/algos/<algo_code>.py` qui implémente `BiddingAlgorithm`
2. Ajouter une ligne dans `modal/bidding_ml/algos/registry.py` :
   ```python
   REGISTRY = {
       "hoeffding_adaptive_tree": HoeffdingAlgo,
       "<algo_code>": NewAlgo,  # ← ajouter ici
   }
   ```
3. INSERT row dans `bidding_algorithms` (si pas déjà présent)
4. `modal deploy modal/bidding_ml/app.py`
5. Lancer `/api/bidding/train` avec `algorithm_code` du nouvel algo, ou
   UPDATE `adaptive_model_state` pour basculer `is_active`.

Aucune autre modification de code (orchestrateur, frontend) n'est nécessaire.

---

## Section 6 — Sécurité

- `pickle.loads` exécute du code arbitraire : utilisé seulement sur des
  données issues de NOTRE base, écrites par CE service via `service_role_key`.
- Le secret Modal `magelian-supabase` est attaché aux fonctions, jamais
  exposé en clair dans les logs.
- Les endpoints HTTPS Modal sont publics par défaut. Si on veut restreindre,
  ajouter un `MODAL_SHARED_SECRET` Header partagé entre Next.js et Modal.

---

## Section 7 — Tests sanity locaux (sans Modal)

```bash
cd modal/bidding_ml
pip install river>=0.21 supabase>=2.10.0 pandas numpy pydantic
pytest tests/ -v
```

Les tests `test_predict.py`, `test_train.py`, `test_drift.py` ne touchent
ni à Modal ni à Supabase — ils valident la logique pure (sérialisation,
roundtrip, agrégation drift).
