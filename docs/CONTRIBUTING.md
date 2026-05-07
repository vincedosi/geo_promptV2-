# Guide contributeur MAGELIAN

## Setup

Cf [README.md](../README.md) section « Setup en 30 minutes ».

## Structure du repo

```
genesis_app/
├── app/                    Next.js App Router
│   ├── api/                Routes API (189 routes)
│   ├── _components/agent/  GeoAgent UI partagée
│   ├── map/                Carte principale + analyses
│   ├── custom-bidding/     Pilotage ML
│   ├── admin/              Back-office
│   └── settings/agent/     Configuration autonomie
├── components/             Composants UI partagés
│   ├── map/                IconBar, OverlayPanel, etc.
│   ├── ui/                 shadcn-style (Button, Dialog, Toast)
│   └── digital/            Analyses DSP (TripleMapView, KpiCardsDsp)
├── lib/                    Helpers serveur + business logic
│   ├── agent/              GeoAgent backend (orchestrator + intents)
│   ├── prompting/          Patterns LLM réutilisables
│   ├── bidding-ml/         Client Modal + comparison helpers
│   ├── chat/               Copilote IA (legacy, /api/chat)
│   ├── dsp-mapping/        Mapping colonnes DSP
│   ├── metrics-display/    Loader/formatter dynamique métriques
│   └── custom-geo/         Custom Geo Capture
├── modal/bidding_ml/       Service Python ML (déployé sur Modal)
├── supabase/migrations/    39 migrations SQL
├── scripts/                Scripts CLI (benchmarking, setup)
├── tests/                  Vitest (unit/integration)
└── docs/                   Documentation
```

## Patterns récurrents

### Ajouter une route API authentifiée

```ts
// app/api/<feature>/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('<table>')
    .select('*')
    .eq('user_id', profile.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}
```

### Ajouter une RPC Supabase

1. Créer migration `supabase/migrations/<YYYYMMDD>_<feature>.sql`
2. Préfixer la fonction métier (ex. `agent_*`, `audit_*`)
3. `LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public'`
4. `GRANT EXECUTE ... TO authenticated, service_role`
5. Appliquer via MCP Supabase (`apply_migration`)
6. Appeler depuis le code : `supabase.rpc('my_func', { p_arg: value })` — paramètres en 2ᵉ argument (jamais de concat string)

### Ajouter un intent à GeoAgent

1. Créer `lib/agent/intents/<code>.ts`
2. Implémenter handler `(input: IntentInput): Promise<IntentOutput>`
   - Charger les données métier depuis Supabase
   - `buildSystemPrompt()` via `lib/prompting/`
   - Appeler Gemini via `generateText({ model: google('gemini-2.5-flash'), … })`
   - `extractJSON()` pour parser le JSON de sortie
   - Retourner `{ response_text, proposed_actions, action_status, tokens_in, tokens_out, duration_ms }`
3. `registerIntent({ code, display_name_fr, description, handler })`
4. Ajouter l'import dans `lib/agent/intents/index.ts > loadAllIntents()`

L'orchestrator détectera automatiquement l'intent (heuristique drift_event_id ou Gemini classifier).

### Ajouter un algo à Custom Bidding

1. Créer `modal/bidding_ml/algos/<algo_code>.py` qui implémente `BiddingAlgorithm` (`predict / learn_one / get_state / load_state`)
2. Ajouter une ligne dans `modal/bidding_ml/algos/registry.py` :
   ```python
   REGISTRY = {
       "hoeffding_adaptive_tree": HoeffdingAlgo,
       "<algo_code>": NewAlgo,
   }
   ```
3. INSERT row dans `bidding_algorithms` (si absent)
4. `modal deploy modal/bidding_ml/app.py`

### Ajouter une métrique au Module Campagne Média

1. INSERT row dans `dsp_metrics_registry` (`code`, `display_name`, `unit`, `display_order`)
2. Le frontend la chargera dynamiquement via `loadMetricsRegistry()` (`lib/metrics-display/loader.ts`) — aucun code TS à modifier
3. Si une RPC d'agrégation par métrique est nécessaire : modifier la RPC `aggregate_campaign_metric` et la rendre paramétrée par `p_metric_code`

## Commits

**Conventional Commits** strictement :

| Préfixe | Usage |
|---|---|
| `feat:` | Nouvelle feature |
| `fix:` | Bug fix |
| `chore:` | Maintenance / cleanup / non-feature |
| `docs:` | Documentation seule |
| `refactor:` | Refacto sans changement comportement |
| `test:` | Ajout de tests |
| `perf:` | Optimisation |

Format : `<type>(<scope>): <message>` — ex: `feat(agent): add explain_decision intent`.

## Branches

- `main` — production
- `feat/<chantier>` — branche de chantier (ex: `feat/analyse-v2`)
- 1 commit atomique par phase d'un chantier (cf historique A4.5 : 7 commits)

## Tests

- `npm test` lance Vitest sur `tests/**/*.test.ts`
- Couverture critique : `lib/prompting/` (34 tests), helpers `lib/bidding-ml/comparison.ts` (à compléter)
- Tests E2E : pas encore automatisés — manuel via Playwright MCP en dev

## Conventions

- TypeScript strict (cf `tsconfig.json`)
- Composants React : PascalCase (`AgentPanel.tsx`)
- Hooks : camelCase préfixés `use` (`useStrategyComparison.ts`)
- Helpers : camelCase
- Constants : SCREAMING_SNAKE_CASE
- Tables SQL : snake_case
- Routes API : kebab-case dossier
- Pas de fichier > 500 lignes (sauf cas justifié)
- Pas de `any`, `@ts-ignore` non commenté
- Pas de `console.log` en commit (logger ou supprimer)

## Sécurité

- **JAMAIS** de secret en clair dans le code (ils vivent dans `.env.local` gitignoré)
- **JAMAIS** `SUPABASE_SERVICE_ROLE_KEY` côté client
- Toutes les tables ont RLS activé
- Toutes les routes API privées passent par `requireAuth` ou `requireAdmin`
- Inputs utilisateurs jamais concaténés en SQL — toujours via params RPC ou `.from(t).eq(...)` paramétré
