# Chantier A4.5 — GeoAgent (agent IA superviseur)

> Date livraison : 2026-04-30
> Statut : V1 livré, end-to-end testé en navigateur

## Résumé exécutif

**GeoAgent** est l'agent IA superviseur de GEOMATIK. Il analyse les drift events détectés par Hoeffding (chantier A4.3), formule des recommandations en français, et selon le niveau d'autonomie configuré, agit ou propose à valider.

V1 du chantier : **flow drift→agent→action complet et testable**.

```
Page /custom-bidding/[id]
   ↓ click « Analyser » sur un drift event
AgentProvider.open({ drift_event_id, strategy_id })
   ↓
AgentPanel auto-trigger /api/agent/analyze-drift
   ↓
Orchestrator → analyze_drift handler → Gemini 2.5 Flash
   ↓ JSON {summary_french, diagnosis, proposed_actions}
enforceAutonomy(actions, level) → applied | suggested
   ↓
INSERT bidding_agent_actions (audit trail)
   ↓
UI affiche réponse + cards recommandations (Apply/Reject)
```

## Architecture

### Code livré (15 fichiers neufs hors lib/prompting/ et hors UI tests)

```
supabase/migrations/20260430_chantier_a4_5_agent_foundation.sql

lib/agent/
├── types.ts                         # AutonomyLevel 0..4, ProposedAction, IntentInput/Output
├── autonomy.ts                      # getAutonomyLevel + enforceAutonomy + applyAction
├── orchestrator.ts                  # handleAgentRequest pipeline
├── system-prompts/
│   ├── base.ts                      # AGENT_IDENTITY + AGENT_RULES_GENERIC
│   └── drift-analysis.ts            # buildDriftAnalysisPrompt(ctx)
└── intents/
    ├── _stub.ts                     # makeStubIntent helper
    ├── index.ts                     # registry pluggable + loadAllIntents
    ├── analyze_drift.ts             # V1 priority handler
    └── {explain_decision, query_data, recommend_action, create_strategy,
         compare_campaigns, navigate, generate_report, detect_anomaly}.ts  # 8 stubs

app/api/agent/
├── chat/route.ts                    # POST: full pipeline
├── analyze-drift/route.ts           # POST: forced intent
├── apply-recommendation/route.ts    # POST: human approve/reject
├── settings/route.ts                # GET/PATCH user_default
├── settings/strategy/[id]/route.ts  # GET/PATCH/DELETE override
└── history/route.ts                 # GET audit trail

app/_components/agent/
├── AgentProvider.tsx                # context (open/close, currentContext)
├── AgentPanel.tsx                   # 420px right side panel + auto-trigger
├── AgentTrigger.tsx                 # floating Sparkles button (bottom-right)
├── AgentRecommendationCard.tsx      # action card with Apply/Reject
├── AgentAutonomyBadge.tsx           # compact level chip
└── index.ts

app/settings/agent/page.tsx          # 5-level autonomy selector

app/custom-bidding/[strategyId]/page.tsx
   + DriftEventsList sub-component   # liste drifts + bouton « Analyser »

app/layout.tsx
   + <AgentProvider> wrapper around children + <AgentTrigger /> + <AgentPanel />
```

### Schéma DB (cf migration)

| Table | Rôle |
|---|---|
| `agent_autonomy_settings` | scope `user_default` ou `strategy_override`, level 0..4, RLS own/admin |
| `bidding_agent_actions` | audit trail complet (intent, recommendations jsonb, llm_*, autonomy_level_at_time) |
| `bidding_drift_events` (cols additives) | `agent_recommendation jsonb`, `agent_analyzed_at timestamptz`, partial index queue |

### 5 niveaux d'autonomie

| Lvl | Nom | Comportement |
|---|---|---|
| 0 | Observer | Aucune action ni notification proactive |
| 1 | Explainer | Notifications proactives, pas d'action |
| 2 | Suggester | Toutes les actions sont proposées (default) |
| 3 | Auto low-risk | Low-risk auto, medium/high suggérées |
| 4 | Full auto | Toutes les actions auto |

### Intents pluggables

V1 implémenté : `analyze_drift` (Gemini Flash + JSON parse + DB update). Les 8 autres (`explain_decision`, `query_data`, `recommend_action`, `create_strategy`, `compare_campaigns`, `navigate`, `generate_report`, `detect_anomaly`) sont des stubs auto-enregistrés dans le registry — ils retournent un message poli "à venir". Ajouter un intent réel = remplacer le `makeStubIntent({…})` par un handler complet, aucune modif d'orchestrator nécessaire.

## Tests E2E (T1-T9)

| # | Test | Résultat |
|---|---|---|
| **T1** | BiddingCopilot supprimé, AnalysisPanel + AnalyseV2 toujours fonctionnels | ✅ tsc clean, 0 ref orpheline |
| **T2** | `lib/prompting/` créé + 34/34 unit tests verts (vitest) | ✅ |
| **T3** | 2 nouvelles tables + 2 cols sur `bidding_drift_events` | ✅ via MCP |
| **T4** | `/api/agent/analyze-drift` retourne réponse FR + recommandations + audit row | ✅ vérifié — 877 in / 470 out tokens, 6132ms, n_recos=2 |
| **T5** | UI panel ouvre, animation, recommandations + Apply/Reject | ✅ end-to-end testé browser |
| **T6** | Page `/settings/agent` charge default 2 (Suggester), PATCH OK | ✅ |
| **T7** | Audit trail : 1 row insérée par interaction agent | ✅ vérifié SQL |
| **T8** | Adform legacy strict | ✅ 4 / 294 135 / 172 056 383 |
| **T9** | `/api/chat`, `/api/smart-prompt` intacts | ✅ tsc + routes OK |

## Scénario pitch testé

1. Vince ouvre `/custom-bidding/56320afa-…` (Pitch Demo Renault Captur)
2. Voit la liste des 3 drift events (low / medium / medium)
3. Click « Analyser » sur le drift `c84aa640…`
4. **AgentPanel s'ouvre à droite**, animation slide-in
5. Auto-trigger `POST /api/agent/analyze-drift` avec drift_event_id
6. Réponse Gemini Flash en ~6s, format strict :
   - **Réponse FR** : *« Un drift de type 'data_drift' a été détecté sur la stratégie 'Pitch Demo — Maximize Leads (Hoeffding)' de la campagne 'Renault Captur — Mars 2026 (Demo Pitch)'. Il s'agit d'une baisse significative de 14.78% du 'win_rate_rural' à l'échelle globale de la stratégie. Le niveau d'autonomie actuel est 'Suggester' (2). »*
   - **2 recommandations suggérées** : `send_alert` (low) + `log_event` (low)
7. Chaque carte expose Apply / Reject
8. Audit trail tracé : intent · token cost · duration · autonomy snapshot

## Procédure pour ajouter un intent

1. Créer `lib/agent/intents/<code>.ts`
2. Implémenter `handler(input: IntentInput): Promise<IntentOutput>`
   - Charger les données métier depuis Supabase
   - Construire un system prompt via `buildSystemPrompt()` de `lib/prompting/`
   - Appeler Gemini via `generateText({ model: google('gemini-2.5-flash'), … })`
   - Parser JSON via `extractJSON()` de `lib/prompting/`
   - Retourner `{ response_text, proposed_actions, action_status, tokens_in, tokens_out, duration_ms }`
3. `registerIntent({ code, display_name_fr, description, handler })`
4. Importer dans `lib/agent/intents/index.ts > loadAllIntents()`

L'orchestrator détectera automatiquement l'intent (heuristique drift_event_id ou Gemini classifier) et l'invoquera.

## Procédure pour ajouter une action

1. Étendre `ActionType` dans `lib/agent/types.ts`
2. Ajouter le case dans `applyAction()` (`lib/agent/autonomy.ts`)
3. Si la nouvelle action est risk=low, elle sera auto-appliquée en niveaux 3-4

## Limites connues V1

- **Streaming non implémenté** : `generateText` synchrone (pas `streamText`). Suffisant pour 6s de latence Flash.
- **Tools function calling** : pas encore plumbé (le PROMPT prévoyait `lib/agent/tools/` mais V1 utilise `generateText` direct, sans `tool` argument). Les 8 stubs d'intents sont la priorité 2.
- **Context detection** : heuristique simple (drift_event_id shortcut + classifier Gemini fallback). Suffisant V1.
- **Notifications proactives** : pas implémentées (level 1 Explainer est défini mais aucun cron ne déclenche actuellement de scan proactif).
- **Strategy override UI** : route API `/api/agent/settings/strategy/[id]` existe mais le composant inline sur StrategyHeader n'est pas mounté V1 (deferred).
- **Tools registry pluggable** : non encore livré. Quand viendra le besoin (ex. Gemini doit appeler `get_campaign_stats`), créer `lib/agent/tools/` + `tools` arg dans `generateText`.

## Métriques observées V1

- Coût LLM : ~877 in / 470 out tokens par drift analysé → ≈ $0.0002 par requête (Gemini 2.5 Flash)
- Latence : ~6s end-to-end (acceptable pour pitch — ~3s prompt + 3s LLM)
- Audit trail : systématique via `bidding_agent_actions` (1 row par interaction)

## Commits atomiques

```
22d8e74  chore(prompting): A4.5 phase 1 — extract reusable patterns to lib/prompting/
ece8997  chore(prompting): A4.5 phase 2 — cancel BiddingCopilot
5465fa0  feat(agent-db):   A4.5 phase 3 — schema for autonomy settings + audit trail
441fbe9  feat(agent-backend): A4.5 phase 4 — orchestrator + 9 pluggable intents (analyze_drift V1)
97c39b2  feat(agent-ui):   A4.5 phase 5 — side panel + context-aware integration
46d27be  feat(agent-autonomy): A4.5 phase 6 — 5-level autonomy settings page
(this)   docs(agent):     A4.5 phase 7 — E2E validation + supervisor agent doc
```
