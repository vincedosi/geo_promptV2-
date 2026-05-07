# Architecture MAGELIAN

> Version 7.x · 2026-04-30

## Vue d'ensemble

```mermaid
graph TB
  subgraph "Next.js (Vercel)"
    UI[Pages /map, /custom-bidding, /admin/*]
    APIRoutes[app/api/* — 189 routes]
    AgentLib[lib/agent — orchestrator + 9 intents]
    PromptingLib[lib/prompting — patterns réutilisables]
  end

  subgraph "Supabase (PostgreSQL 15 + PostGIS)"
    Tables[(70 tables — RLS partout)]
    RPCs[24 RPCs métier custom]
  end

  subgraph "Modal (Python serverless HTTPS)"
    Predict[/predict — Hoeffding inference/]
    Train[/train — re-fit/]
    Drift[/detect-drift — statistical scan/]
  end

  subgraph "External LLM"
    Gemini[Gemini 2.5 Flash]
    Mistral[Mistral Small fallback]
  end

  UI -->|adminFetch| APIRoutes
  APIRoutes -->|admin client| Tables
  APIRoutes -->|.rpc| RPCs
  APIRoutes -->|HTTPS| Predict
  APIRoutes -->|HTTPS| Train
  APIRoutes -->|HTTPS| Drift
  APIRoutes -->|@ai-sdk/google| Gemini
  AgentLib -->|generateText| Gemini
  AgentLib -->|admin client| Tables
  Predict -->|supabase-py| Tables
  Train -->|supabase-py| Tables
  Drift -->|supabase-py| Tables
```

## Modules majeurs

### Frontend (Next.js)

| Module | Rôle |
|---|---|
| `app/copilote/`, `app/map/` | Carte principale MapLibre + filtres + analyses |
| `app/map/analyse/digital/` | Module Campagne Média (analyse DSP par CP/dept/région) |
| `app/custom-bidding/[id]/` | Dashboard Custom Bidding (KPI delta, choroplèthe split, play, timeline) |
| `app/_components/agent/` | GeoAgent UI (provider, panel, recommendations) |
| `app/admin/*` | Back-office (campagnes, sources, users, orgs, imports) |
| `app/settings/agent/` | Configuration niveau d'autonomie agent IA |
| `components/map/*` | IconBar, OverlayPanel, ResultsPanel — chrome carte |

### Backend lib

| Lib | Rôle |
|---|---|
| `lib/auth.ts` | createAdminClient + getUserFromRequest (helper auth) |
| `lib/admin-fetch.ts` | wrapper fetch côté client avec Bearer token Supabase |
| `lib/api/middleware.ts` | requireAuth, requireAdmin, authUnauthorized helpers |
| `lib/api/rate-limit.ts` | createRateLimiter (Upstash Redis ou in-memory) |
| `lib/agent/` | Orchestrator + intent registry + autonomy enforcement (chantier A4.5) |
| `lib/prompting/` | Patterns réutilisables LLM (chantier A4.5 phase 1) |
| `lib/bidding-ml/client.ts` | HTTP client vers Modal endpoints |
| `lib/bidding-ml/comparison.ts` | Helpers d'agrégation données comparison |
| `lib/dsp-mapping/` | Mapping colonnes DSP source (Adform / TTD / DV360) |
| `lib/metrics-display/` | Loader + formatter dynamique des métriques (`dsp_metrics_registry`) |
| `lib/custom-geo/*` | Custom Geo Capture (zones personnalisées) |
| `lib/chat/*` | Copilote IA principal (legacy `/api/chat`, 17 outils) |

### ML (Python · Modal)

`modal/bidding_ml/`

| Fichier | Rôle |
|---|---|
| `app.py` | 3 endpoints HTTPS — predict/train/detect-drift |
| `algos/registry.py` | Registry pluggable (Hoeffding aujourd'hui) |
| `algos/hoeffding.py` | Wrapper river HoeffdingAdaptiveTreeRegressor |
| `data_loader.py` | Supabase JS Client HTTPS (port 443) |
| `persistence.py` | UPSERT bidding_zone_configs / proposals / daily_state |
| `drift_detection.py` | Scan statistique CPL/CTR par CP × 2 fenêtres |
| `serialization.py` | pickle+base64 sérialisation modèle river |

### DB (Supabase)

70 tables publiques. Catégories :

| Catégorie | Tables clés |
|---|---|
| **Multi-tenant** | profiles, organizations, organization_members, campaign_organizations |
| **Campagnes DSP** | dsp_campaigns, dsp_campaign_data, dsp_source_mappings, dsp_metrics_registry |
| **Custom Bidding** | bidding_algorithms, bidding_objectives, bidding_strategies, bidding_zone_configs, bidding_zone_config_proposals, bidding_daily_state, bidding_drift_events, adaptive_model_state |
| **Agent IA** | agent_autonomy_settings, bidding_agent_actions |
| **Géographie INSEE** | iris (51k), carreaux_filosofi (2.3M), carreaux_2km, carreaux_5km, ref_codes_postaux, france_borders |
| **POI / Panneaux** | poi (poi_france view), panneaux_affichage, global_ooh, poi_categories |
| **Radio** | emetteur_radio, radio_stations, emetteur_radio_stations |
| **Custom Geo** | custom_geo_zones, custom_geo_zone_codes |
| **Scoring / Clustering** | scoring_profiles, clustering_models, poi_clusters |
| **Support** | saved_maps, isochrones_cache, calculation_jobs |

24 RPCs métier custom (préfixes `get_*`, `aggregate_*`, `match_*`, `compute_*`).

## Flow type — Drift event end-to-end

1. Modal `/detect-drift` lancé périodiquement (cron à mettre en place)
2. Compare 2 fenêtres 7j de `bidding_daily_state` (CPL/CTR par CP)
3. Insère row dans `bidding_drift_events` si delta > seuil
4. Planner ouvre `/custom-bidding/[strategy_id]` → voit le drift dans la timeline
5. Click « Analyser » → ouvre `AgentPanel` (right side) → context = drift_event_id
6. Auto-trigger `POST /api/agent/analyze-drift`
7. `lib/agent/orchestrator.ts` → `analyze_drift` handler
8. Charge drift + strategy + campaign + 14 derniers jours daily_state
9. `buildDriftAnalysisPrompt()` → Gemini 2.5 Flash → JSON `{summary_french, diagnosis, proposed_actions}`
10. Update `bidding_drift_events.agent_recommendation`
11. `enforceAutonomy(actions, level)` selon `agent_autonomy_settings`
12. `INSERT bidding_agent_actions` (audit trail)
13. UI affiche réponse + cards Apply/Reject

## Patterns récurrents

- **Routes API** : `requireAuth` ou `requireAdmin` en haut, `createAdminClient()` pour les writes, `NextResponse.json` pour le retour
- **Side panel overlays** (`/map`) : `OverlayPanel` + `IconBar` + `useState<OverlayId | null>`
- **Imports DB batch** : 50 rows max par INSERT/UPSERT (cf `lib/import/inserter.ts`)
- **MapLibre layers** : ID préfixé `digital-` ou `battle-`, source GeoJSON, paint via expression
- **Streaming SSE** : `coverage-stats`, `inserter` — `ReadableStream` + ndjson
- **Auth client** : `adminFetch()` injecte Bearer token Supabase depuis cookies session

## Conventions

- **Composants** : PascalCase, fichier `.tsx`
- **Hooks** : `useXxx.ts`, camelCase
- **Helpers** : camelCase
- **Routes API** : kebab-case dossier, `route.ts` dedans
- **Tables SQL** : snake_case
- **Constants** : SCREAMING_SNAKE_CASE
- **Commits** : Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`)
