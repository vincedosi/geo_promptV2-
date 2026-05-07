# MAGELIAN

> SaaS B2B de géomarketing OOH/DOOH + Custom Bidding ML pour campagnes DSP. Planification d'affichage extérieur sur données INSEE, ciblage carto temps réel, optimisation algorithmique des bids, agent IA superviseur.

## Stack

| Couche | Techno |
|---|---|
| Frontend | Next.js 14 App Router · TypeScript strict · Tailwind |
| Cartographie | MapLibre GL JS · PMTiles (IRIS via GitHub Releases) · OpenFreeMap |
| Backend | Supabase Pro (PostgreSQL 15 + PostGIS, compute Nano) |
| ML | Python · river (Hoeffding Adaptive Tree) · déployé sur Modal (HTTPS) |
| LLM | Vercel AI SDK · Gemini 2.5 Flash (default) · Mistral Small (fallback) |
| Jobs async | Inngest |
| Hosting | Vercel |

## Setup en 30 minutes

### Prérequis

- Node.js 20+
- npm (ou pnpm)
- Compte [Supabase](https://supabase.com) (free tier OK)
- Compte [Modal](https://modal.com) (free tier OK, $30/mois suffit)
- Clé API [Gemini](https://aistudio.google.com/app/apikey) (free tier OK)

### Étapes

1. **Clone**
   ```bash
   git clone <repo-url>
   cd genesis_app
   ```

2. **Install dépendances**
   ```bash
   npm install
   ```

3. **Variables d'environnement**
   ```bash
   cp .env.example .env.local
   # Remplir .env.local avec vos vraies clés
   ```

4. **Vérifier la config**
   ```bash
   npx tsx scripts/setup-check.ts
   ```
   Le script vérifie connexion Supabase, clé Gemini, URL Modal.

5. **Migrations DB**
   Les migrations sont déjà appliquées sur le projet Supabase de dev. Pour un nouveau projet, voir [docs/deployment.md](docs/deployment.md).

6. **Déployer Modal (Custom Bidding ML)**
   ```bash
   modal token set --token-id ak-... --token-secret as-...
   modal secret create magelian-supabase \
     SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
     SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY"
   modal deploy modal/bidding_ml/app.py
   # Coller l'URL retournée dans .env.local sous MODAL_BIDDING_ML_URL
   ```

7. **Lancer en dev**
   ```bash
   npm run dev
   ```
   App disponible sur http://localhost:3000

### Variables d'environnement

Voir [`.env.example`](.env.example) pour la liste exhaustive et documentée.

**Obligatoires** :
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_GENERATIVE_AI_API_KEY` (Gemini, pour l'agent IA)
- `MODAL_BIDDING_ML_URL` (pour Custom Bidding)

**Optionnelles** :
- `MISTRAL_API_KEY` (fallback LLM)
- `ORS_API_KEY` (isochrones)
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (rate limiting prod)
- `GITHUB_TOKEN` (proxy PMTiles si dépôt privé)

## Architecture

Vue d'ensemble : [docs/architecture.md](docs/architecture.md)

```
┌─ Next.js (Vercel) ─────────────┐    HTTPS    ┌─ Modal (Python) ──┐
│  /map (MapLibre)               │ ──────────► │  bidding-ml       │
│  /custom-bidding/[strategy_id] │             │  predict / train  │
│  /api/bidding/* /api/agent/*   │             │  detect-drift     │
└──────────┬─────────────────────┘             └──────────┬────────┘
           │                                              │
           ▼                                              ▼
   ┌─────────────────────────────────────────────────────────┐
   │  Supabase (PostgreSQL 15 + PostGIS)                     │
   │  bidding_strategies, adaptive_model_state,              │
   │  bidding_zone_configs, bidding_drift_events,            │
   │  bidding_agent_actions, dsp_campaigns, iris, …          │
   └─────────────────────────────────────────────────────────┘
```

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — vue d'ensemble + responsabilités modules
- [`docs/deployment.md`](docs/deployment.md) — procédure prod (Supabase + Modal + Vercel)
- [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) — guide dev (ajouter feature/RPC/intent/algo)
- [`docs/decisions.md`](docs/decisions.md) — Architecture Decision Records (10 ADRs)
- [`docs/glossary.md`](docs/glossary.md) — termes métier OOH/DOOH/DSP
- [`docs/runbook.md`](docs/runbook.md) — opérations courantes
- [`docs/cleanup_inventory.md`](docs/cleanup_inventory.md) + [`docs/cleanup/*.md`](docs/cleanup/) — audits cleanup A4.6
- [`docs/chantier_*.md`](docs/) — historique des chantiers livrés

## Commandes

```bash
npm run dev              # Dev server (localhost:3000)
npm run build            # Build prod
npm test                 # Tests Vitest (lib/prompting, etc.)
npm run lint             # ESLint
npx tsc --noEmit         # Type-check
npx tsx scripts/setup-check.ts  # Vérif config locale
```

## Sources de données et licences

Les indicateurs de santé environnementale (qualité de l'air ATMO et pollen) affichés dans la section "Données terrain" sont fournis par **Atmo France et les AASQA** (Associations agréées de surveillance de la qualité de l'air), via l'API Atmo Data v2. Données mises à disposition sous licence **ODbL** (Open Database License). Toute réutilisation publique doit conserver la mention `Source : Atmo France et les AASQA`.

- Site : https://www.atmo-france.org
- Carte officielle : https://map.atmo-france.org
- Doc API : https://admindata.atmo-france.org/api/doc/v2

Les autres sources de données géographiques (IRIS INSEE, carreaux Filosofi, abstention présidentielle 2022) suivent leurs licences respectives — voir `docs/glossary.md` et les commentaires de chaque table SQL.
