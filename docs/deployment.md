# Procédure de déploiement MAGELIAN

## Vue d'ensemble

MAGELIAN = 3 services à déployer :
1. **Frontend Next.js** sur Vercel
2. **Backend ML** (Python) sur Modal
3. **DB + Auth** sur Supabase

## 1. Setup Supabase (15 min)

### 1.1 Création projet

1. https://supabase.com → New project
2. Région : `eu-west-3` (Paris) recommandée pour latence FR
3. Pricing : Pro suffit pour démarrer (compute Nano)

### 1.2 Activer extensions

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

### 1.3 Appliquer migrations

```bash
cd genesis_app
# Option 1 : via Supabase CLI
supabase link --project-ref <your-ref>
supabase db push

# Option 2 : via MCP Supabase (recommandé pour Claude)
# Chaque fichier supabase/migrations/*.sql appliqué successivement
```

39 migrations à appliquer dans l'ordre alphabétique (timestamp préfixé).

### 1.4 Récupérer les clés

Dashboard Supabase → Settings → API :
- Project URL → `NEXT_PUBLIC_SUPABASE_URL`
- `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` secret key → `SUPABASE_SERVICE_ROLE_KEY` (**NEVER** côté client)

### 1.5 Seed démo (optionnel)

```sql
-- Sécurité : ce seed est destiné à un environnement DEMO uniquement
\i supabase/migrations/<latest>_demo_dataset.sql
```

## 2. Setup Modal (10 min)

### 2.1 Créer compte + tokens

1. https://modal.com/signup
2. https://modal.com/settings/tokens → Create token
3. Local CLI :
   ```bash
   pip install modal
   modal token set --token-id ak-... --token-secret as-...
   ```

### 2.2 Créer le secret Supabase côté Modal

```bash
modal secret create magelian-supabase \
  SUPABASE_URL="https://<your-ref>.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="eyJ..."
```

### 2.3 Déployer le service

```bash
cd genesis_app
modal deploy modal/bidding_ml/app.py
```

Modal retourne 3 URLs (predict / train / detect-drift). Préfixe commun à coller dans `MODAL_BIDDING_ML_URL`.

### 2.4 Smoke test

```bash
curl -X POST "https://<workspace>--bidding-ml-predict.modal.run" \
  -H "Content-Type: application/json" \
  -d '{"strategy_id":"00000000-0000-0000-0000-000000000000"}'
# Attendu : {"error":"Strategy not found","status":404}
```

## 3. Setup Vercel (5 min)

### 3.1 Lier le repo

1. https://vercel.com → Import Project
2. Sélectionner le repo GitHub
3. Framework auto-detect : Next.js
4. Build command : `npm run build` (defaut)
5. Output : `.next` (defaut)

### 3.2 Variables d'environnement

Dashboard Vercel → Settings → Environment Variables.

Pour chaque variable de [`.env.example`](../.env.example) :
- Cocher `Production`, `Preview`, `Development`
- Pour `SUPABASE_SERVICE_ROLE_KEY` : **uniquement** `Production` + `Preview` (jamais `Development` qui exposerait au browser via Vercel preview)

Variables minimales prod :
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_GENERATIVE_AI_API_KEY`
- `MODAL_BIDDING_ML_URL`

Optionnelles :
- `MISTRAL_API_KEY` (fallback)
- `ORS_API_KEY` (isochrones)
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (rate limiting)

### 3.3 Domain

Settings → Domains → Add custom domain. Pour démo : le `<project>.vercel.app` suffit.

### 3.4 Déployer

`git push origin main` → Vercel build automatique.

## 4. Setup Gemini (3 min)

1. https://aistudio.google.com/app/apikey → Create API key
2. Coller dans `.env.local` + Vercel env vars sous `GOOGLE_GENERATIVE_AI_API_KEY`

Free tier : 60 req/min, 1500 req/jour. Suffisant pour démarrer.

## 5. Tests post-déploiement (5 min)

### 5.1 Smoke routes API

```bash
# Auth required → 401 attendu
curl https://<your-app>.vercel.app/api/bidding/strategies
# Attendu : {"success":false,"error":"Authentification requise."}

# MVT public
curl https://<your-app>.vercel.app/api/tiles/8/130/89
# Attendu : 200 + bytes binaires

# Modal proxy
curl -X POST https://<your-app>.vercel.app/api/bidding/predict \
  -H "Content-Type: application/json" \
  -d '{"strategy_id":"00000000-..."}'
# Attendu : 401 (auth required) ou 502 si Modal mal configuré
```

### 5.2 Smoke pages UI

Dans le navigateur (logged-in) :
1. `/` → page d'accueil
2. `/map` → MapLibre rendu, IconBar visible
3. `/map/analyse/digital` → liste des campagnes
4. `/custom-bidding` → liste des stratégies
5. `/custom-bidding/<demo_strategy_id>` → dashboard complet
6. `/settings/agent` → 5 cards de niveaux d'autonomie

### 5.3 Smoke pitch flow

1. Sur `/custom-bidding/<demo>` → liste drift events visible
2. Click « Analyser » sur un drift → AgentPanel s'ouvre
3. Réponse FR de Gemini en ~6s
4. Recommandations Apply/Reject visibles

## Troubleshooting

### "MODAL_BIDDING_ML_URL non configurée"
- Var manquante dans Vercel env vars OU `.env.local`
- Restart `npm run dev` ou redéploiement Vercel après modif

### Maps blanches sur `/map`
- PMTiles inaccessibles → vérifier `GITHUB_TOKEN` si dépôt PMTiles privé
- Console browser → Network errors sur `iris-tiles-proxy`

### `/api/bidding/predict` retourne 401
- Modal lui-même est OK mais l'auth Supabase côté route Next.js a échoué
- Vérifier que le user est logged-in côté browser (cookie `sb-...-auth-token` présent)

### Drift events n'apparaissent pas
- Cf [`docs/runbook.md`](runbook.md) section « Debug un drift event »

### Agent ne répond pas en français
- Vérifier `GOOGLE_GENERATIVE_AI_API_KEY` dans env vars
- Logs Vercel : `process.env.GOOGLE_GENERATIVE_AI_API_KEY` doit être défini

### Coût LLM
- Dashboard Google AI Studio → Billing
- Estimation prod : ~$0.0002 par drift analysé en Gemini 2.5 Flash
