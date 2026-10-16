# MAGELIAN

> SaaS B2B de géomarketing OOH/DOOH + Custom Bidding pour campagnes DSP. Planification d'affichage extérieur sur données INSEE, ciblage carto temps réel, export des multiplicateurs d'enchères par code postal.

## Stack

| Couche | Techno |
|---|---|
| Frontend | Next.js 14 App Router · TypeScript strict · Tailwind |
| Cartographie | MapLibre GL JS · PMTiles (IRIS via GitHub Releases) · OpenFreeMap |
| Backend | Supabase Pro (PostgreSQL 15 + PostGIS, compute Nano) |
| Jobs async | Inngest |
| Hosting | Vercel |

## Setup en 30 minutes

### Prérequis

- Node.js 20+
- npm (ou pnpm)
- Compte [Supabase](https://supabase.com) (free tier OK)

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
   Le script vérifie les variables obligatoires et la connexion Supabase.

5. **Migrations DB**
   Les migrations sont déjà appliquées sur le projet Supabase de dev. Pour un nouveau projet, voir [docs/deployment.md](docs/deployment.md).

6. **Lancer en dev**
   ```bash
   npm run dev
   ```
   App disponible sur http://localhost:3000

### Variables d'environnement

Voir [`.env.example`](.env.example) pour la liste exhaustive et documentée.

**Obligatoires** :
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`

**Optionnelles** :
- `ORS_API_KEY` (isochrones)
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (rate limiting prod)
- `GITHUB_TOKEN` (proxy PMTiles si dépôt privé)

## Architecture

> Le service ML Python sur Modal, l'agent d'enchères et l'historique de chat
> ont été retirés le 2026-10-12 (suppression de l'IA). Les multiplicateurs
> d'enchères par code postal sont produits localement (`lib/zones/plan.ts`).
> Source de vérité de l'architecture : [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Documentation

- [`docs/deployment.md`](docs/deployment.md) — procédure prod (périmée : Supabase hébergé, Vercel et Modal ne sont plus utilisés)
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
