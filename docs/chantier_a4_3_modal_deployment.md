# Chantier A4.3 — Backend ML production : Hoeffding sur Modal

> Date : 2026-04-29
> Statut : code livré, **déploiement Modal restant côté Vince** (credentials requis)

## Résumé exécutif

Hoeffding Adaptive Tree (gagnant A4.2 avec +91.97% de lift sur le dataset démo) est packagé pour déploiement sur **Modal** (modal.com), un runtime serverless Python en HTTPS.

Le frontend Next.js appelle Modal via 3 endpoints HTTPS :

| Endpoint Next.js | Endpoint Modal | Rôle |
|---|---|---|
| `POST /api/bidding/predict` | `POST <prefix>-predict.modal.run` | Génère les `bid_multiplier` selon `execution_mode` |
| `POST /api/bidding/train` | `POST <prefix>-train.modal.run` | Ré-entraîne le modèle sur les N derniers jours |
| `POST /api/bidding/detect-drift` | `POST <prefix>-detect-drift.modal.run` | Scanne `bidding_daily_state` pour drifts |

Plus 3 routes purement Next.js / Supabase (pas d'appel Modal) :

- `GET /api/bidding/proposals?strategy_id=<id>&status=pending` — liste les propositions
- `POST /api/bidding/proposals/[id]/approve` — applique une proposition (UPSERT vers `bidding_zone_configs`)
- `POST /api/bidding/proposals/[id]/reject` — marque rejetée

## Architecture

```
┌──────────────────────────────┐        HTTPS       ┌────────────────────────────┐
│  Next.js (Vercel)            │ ─────────────────► │  Modal (modal.com)         │
│                              │                    │                            │
│  /api/bidding/predict   ──┐  │                    │  bidding-ml-predict        │
│  /api/bidding/train     ──┤  │                    │  bidding-ml-train          │
│  /api/bidding/detect-…  ──┼──┼──┐                 │  bidding-ml-detect-drift   │
│                              │  │                 │                            │
│  /api/bidding/proposals    ──┘  │                 │  ┌──────────────────────┐  │
│  /api/bidding/proposals/     ───┤                 │  │ algos/registry.py    │  │
│    [id]/approve  (Supabase) ────┤                 │  │   → HoeffdingAlgo    │  │
│    [id]/reject   (Supabase) ────┘                 │  │   (extensible)        │  │
│                              │                    │  └──────────────────────┘  │
└──────────────────────────────┘                    │  service_role_key (Secret) │
              │                                     └────────────┬───────────────┘
              │ admin client (no-store)                          │ supabase-py (HTTPS)
              ▼                                                  ▼
    ┌────────────────────────────────────────────────────────────────────────────┐
    │  Supabase Postgres                                                         │
    │   • bidding_strategies (+execution_mode A4.3)                              │
    │   • adaptive_model_state (parameters jsonb avec model pickle+b64)          │
    │   • bidding_zone_configs                                                   │
    │   • bidding_zone_config_proposals (NEW A4.3)                               │
    │   • bidding_daily_state                                                    │
    │   • bidding_drift_events                                                   │
    └────────────────────────────────────────────────────────────────────────────┘
```

## Modes d'exécution (`bidding_strategies.execution_mode`)

| Mode | Effet de `/predict` | Cible |
|---|---|---|
| `monitor_only` | UPSERT `bidding_daily_state` avec `applied_bid_multiplier` (log only) | Audit / shadow run |
| `suggest` | INSERT `bidding_zone_config_proposals` (status=pending, expire 7j) | Validation humaine |
| `auto` | UPSERT direct dans `bidding_zone_configs` | Pitch démo, runs en confiance |

Default sur nouvelle stratégie : `suggest`. La stratégie de pitch démo est passée en `auto` par migration.

## Sérialisation des modèles

`river.tree.HoeffdingAdaptiveTreeRegressor` est sérialisé via `pickle` puis encodé en `base64` pour stockage dans `adaptive_model_state.parameters` JSONB :

```json
{
  "n_samples": 4078,
  "reward_history": [...500 dernières],
  "scaler": { "_serializer": "pickle_b64", "_version": 1, "data": "...", "size_bytes": 1234 },
  "model":  { "_serializer": "pickle_b64", "_version": 1, "data": "...", "size_bytes": 56789 }
}
```

⚠️ **Sécurité** : `pickle.loads` exécute du code arbitraire. Cette utilisation
n'est sûre QUE parce que les payloads viennent de NOTRE base, écrits par
NOTRE service Modal authentifié. **NE JAMAIS désérialiser un payload externe.**

## Procédure pour Vince (déploiement initial)

### Étape 1 — Tokens Modal CLI

```bash
modal token set --token-id ak-... --token-secret as-...
```

### Étape 2 — Secret Supabase côté Modal

```bash
modal secret create magelian-supabase \
  SUPABASE_URL="https://vkkdbygwbrxyogqosten.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="<service_role_key Supabase Dashboard → Settings → API>"
```

### Étape 3 — Déploiement

```bash
cd C:\GENESIS\genesis_app
pip install modal
modal deploy modal/bidding_ml/app.py
```

Récupérer les 3 URLs retournées et leur **préfixe commun** (sans `-predict.modal.run`).

### Étape 4 — `.env.local` racine (ajout uniquement, pas de modif des vars existantes)

```
MODAL_TOKEN_ID=ak-xxxxx
MODAL_TOKEN_SECRET=as-xxxxx
MODAL_BIDDING_ML_URL=https://<workspace>--bidding-ml
```

Le client TS (`lib/bidding-ml/client.ts`) ajoute `-predict.modal.run`, `-train.modal.run`, etc.

### Étape 5 — Test smoke

```bash
curl -X POST "$MODAL_BIDDING_ML_URL-predict.modal.run" \
  -H "Content-Type: application/json" \
  -d '{"strategy_id": "00000000-0000-0000-0000-000000000000"}'
# Attendu : 200 avec body {"error": "Strategy ... not found", "status": 404}
```

## Procédure : ajouter un nouvel algo

1. Créer `modal/bidding_ml/algos/<algo_code>.py` qui implémente `BiddingAlgorithm` avec `predict / learn_one / get_state / load_state`
2. Ajouter une ligne dans `modal/bidding_ml/algos/registry.py` :
   ```python
   REGISTRY = {
       "hoeffding_adaptive_tree": HoeffdingAlgo,
       "<algo_code>": NewAlgo,
   }
   ```
3. INSERT row dans `bidding_algorithms` (si absent)
4. `modal deploy modal/bidding_ml/app.py`
5. Lancer `/api/bidding/train` avec une stratégie référençant le nouvel `algorithm_code`

L'orchestrateur (`app.py`) et le frontend ne changent pas.

## Procédure : swap d'algo actif sur une stratégie

```sql
-- Désactive l'ancien
UPDATE adaptive_model_state SET is_active = false, retired_at = NOW()
WHERE strategy_id = '<id>' AND is_active = true;

-- Active le nouveau (idempotent grâce au partial unique index)
UPDATE adaptive_model_state SET is_active = true, promoted_at = NOW()
WHERE id = '<new_model_id>';
```

Le prochain `/predict` chargera automatiquement le nouveau modèle.

## Limites connues

- `pickle` n'est pas portable entre versions river majeures. À chaque upgrade
  river, prévoir un re-train.
- Le modèle complet (river tree + scaler) tient en jsonb ; pour de gros
  arbres, surveiller la taille (`size_bytes` est tracké dans le payload).
- Le scan de drift est niveau 2 (statistical sur CPL/CTR par CP) — pas de
  test KS ni de chi² ici. À enrichir si nécessaire.

## Fichiers livrés

```
supabase/migrations/20260429_chantier_a4_3_execution_modes.sql

modal/bidding_ml/
├── README.md
├── pyproject.toml
├── app.py
├── data_loader.py
├── persistence.py
├── drift_detection.py
├── serialization.py
├── algos/
│   ├── __init__.py
│   ├── base.py
│   ├── hoeffding.py
│   └── registry.py
└── tests/
    ├── __init__.py
    ├── test_predict.py
    ├── test_train.py
    └── test_drift.py

lib/bidding-ml/
└── client.ts

app/api/bidding/
├── predict/route.ts
├── train/route.ts
├── detect-drift/route.ts
└── proposals/
    ├── route.ts
    └── [id]/
        ├── approve/route.ts
        └── reject/route.ts
```

## Tests E2E (T1-T6)

Voir `modal/bidding_ml/README.md` section 3 pour les commandes exactes.
T1-T5 nécessitent Modal déployé. T6 (Adform legacy) est purement SQL.
