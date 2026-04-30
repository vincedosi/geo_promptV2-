# CHANTIER A4.5 — Agent IA superviseur (GeoAgent)

## CONTEXTE STRATÉGIQUE

Suite aux Chantiers A4.1 → A4.4.5 : Custom Bidding ML opérationnel de bout en bout (Hoeffding sur Modal, mode auto/suggest/monitor, page UI pitch-ready, intégration sidebar GEOMATIK).

**Aujourd'hui le système est purement "ML qui calcule des chiffres".** Il manque la **couche d'intelligence supérieure** qui :
- Lit les drift events détectés
- Croise avec le contexte business (concurrents, météo, événements, autres campagnes)
- Explique en français au planner
- Recommande une action
- Agit (selon niveau d'autonomie configuré)

Cette couche = **le différenciant pitch ultime** vs CARTO/MyTraffic/Gini. C'est ce qui transforme GEOMATIK de "outil d'analyse géo + algo ML" en **"copilote IA pour planner DSP"**.

L'audit pré-A4.5 (`docs/chantier_a4_5_audit_prompting_existant.md`) a révélé :
- ✅ Socle prompting partiellement réutilisable : `/api/chat` (85% prod, 17 outils Vercel AI SDK + Gemini 2.5 Flash)
- ⚠️ Smart-prompt orchestrateur (30% alpha) → à consolider/killer
- 🗑️ BiddingCopilot (40% démo, 650 lignes) → à canceller après extraction patterns réutilisables
- 🎯 5 patterns réutilisables identifiés dans BiddingCopilot avant cancellation

**Décisions produit validées avec Vince** :
- **D1** : Gemini 2.5 Flash partout (pas de Pro pour V1, optimisation coûts)
- **D2** : 9+ intents pluggables (architecture extensible, future-proof)
- **D3** : Extraction `lib/prompting/` AVANT cancel BiddingCopilot (5 patterns à recycler)
- **D4** : 5 niveaux d'autonomie configurables par le planner (Observer/Explainer/Suggester/Auto-low-risk/Auto-full)
- **D5** : V1 focus drift analysis (priorité 1) + 8 autres intents (priorité 2)
- **D6** : Single agent (cancel BiddingCopilot, kill smart-prompt)

**Principe absolu GEOMATIK : RIEN HARDCODÉ.** Les intents sont déclarés dans une registry pluggable. Les outils tool calling lisent toutes les données depuis la base. Aucun nom de campagne / DSP / algo en dur dans le code agent.

---

## SCOPE DU CHANTIER

**Important** : ce chantier est gros (~80-100h estimé Claude Code). Vince a explicitement choisi le **monolithique**. Il faut donc rigoureusement :
- Découper en 7 phases distinctes
- Faire des sub-agents en parallèle quand possible
- Committer atomiquement à chaque phase (pas un méga commit en fin)
- Pouvoir mettre en pause et reprendre proprement entre phases

### 7 phases

1. **Extraction `lib/prompting/`** (récupérer les 5 patterns BiddingCopilot)
2. **Cancellation BiddingCopilot** + cleanup orphelins
3. **Migrations DB** (`agent_autonomy_settings`, `bidding_agent_actions`, colonnes additives)
4. **Backend agent** (`/api/agent/*` routes + orchestrateur intent router + 9 handlers)
5. **UI panel agent** (side panel droit ouvrable depuis nav)
6. **Système d'autonomie** (UI settings + enforcement côté backend)
7. **Tests E2E + audit trail validation**

---

## SKILLS OBLIGATOIRES

@verification-before-completion @executing-plans @systematic-debugging @smart-explore @finishing-a-development-branch @writing-plans @brainstorming @dispatching-parallel-agents @receiving-code-review @requesting-code-review @subagent-driven-development @test-driven-development @using-git-worktrees @using-superpowers @writing-skills @do @make-plan @mem-search @timeline-report @frontend-design

## SKILLS GEOMATIK À CHARGER

- `geomatik-metier`
- `supabase-geomatik`
- `dsp-campaigns`

---

## RÉFÉRENCES OBLIGATOIRES

- `CLAUDE.md`
- `ARCHITECTURE.md`
- `DESIGN_SYSTEM.md`
- `docs/chantier_a4_5_audit_prompting_existant.md` ← **lire intégralement**
- `docs/chantier_a4_3_modal_deployment.md` (cf endpoints Modal disponibles)
- `docs/chantier_a4_4_pitch_ui.md` (cf composants UI Custom Bidding)
- `docs/chantier_a4_4_5_ux_integration.md` (cf intégration sidebar)

---

## FICHIERS / OBJETS INTERDITS

**Ne JAMAIS modifier ou supprimer** :

### Tables et données
- Aucun ALTER destructif sur les 8 tables `bidding_*` ou `adaptive_model_state` (ALTER additif OK)
- Aucune modif `dsp_*`, `custom_geo_*`, sauf ALTER additif documenté
- Adform legacy strict (4 / 294 135 / 172 056 383)

### RPCs production
- Aucune modif des RPCs production (12) + A3 (2) + A3.1 (3) + A4.4 (1)
- OK pour créer de nouvelles RPCs si nécessaire (préfixe `agent_*` ou `audit_*`)

### Code applicatif
- `/api/isochrone-battle/route.ts` + fonctions PostGIS `battle_*`
- Modal `modal/bidding_ml/*` (intact, on appelle juste les endpoints)
- Page `/custom-bidding/[strategyId]` et ses composants (intacts)
- Module Campagne Média existant (intact)
- `lib/dsp-mapping/*`, `lib/metrics-display/*`, `lib/bidding-ml/*` (intacts)
- Smart-prompt (`/api/smart-prompt`, `lib/smart-prompt/*`) → **garder intact dans A4.5**, on n'y touche pas (la décision de killer est différée à un futur chantier de cleanup)
- Chat copilote `/api/chat` → **garder intact** (on construit l'agent superviseur en parallèle, pas en remplacement de `/api/chat`)
- `.env.local` (pas de modif user, sauf vars `AGENT_*` ajoutées en bas du fichier si nécessaire)

Si tu identifies un besoin de toucher à un de ces objets : **STOP et demande confirmation avant**.

---

## PHASE 1 — EXTRACTION lib/prompting/

### 1.1 Objectif

Extraire les 5 patterns réutilisables identifiés dans BiddingCopilot vers une lib partagée `lib/prompting/`. Ces patterns serviront pour :
- L'agent A4.5 lui-même
- Toute future feature LLM dans GEOMATIK
- Une éventuelle consolidation du chat copilote `/api/chat` plus tard

### 1.2 Structure cible

```
lib/prompting/
├── README.md                       # Description des patterns
├── system-prompt-builder.ts        # Pattern 1 : construction de system prompts dynamiques
├── json-extraction.ts              # Pattern 2 : extraction JSON depuis réponse LLM (regex + error handling)
├── code-generation/                # Pattern 3 : templates de code generation (DV360, Adform, TTD)
│   ├── dv360.ts
│   ├── adform.ts
│   └── ttd.ts                      # nouveau, à créer pour cohérence avec A4.3
├── rate-limiter.ts                 # Pattern 4 : rate limiting per-user (Upstash + fallback in-memory)
├── chat-ui/                        # Pattern 5 : composants UI chat partagés
│   ├── MessageList.tsx
│   ├── MessageInput.tsx
│   ├── CodeTabs.tsx
│   └── DownloadButton.tsx
└── types.ts                        # Types partagés (Message, ChatRequest, etc.)
```

### 1.3 Méthode

Sub-agent A : extraction strictement à l'identique depuis BiddingCopilot, avec suppression des références spécifiques au bidding (renommer en termes génériques).

⚠️ Tests unitaires sur les 2 patterns critiques :
- `system-prompt-builder.test.ts` : verifie l'interpolation correcte des variables
- `json-extraction.test.ts` : vérifie le parsing JSON robuste face aux réponses LLM mal formées

### 1.4 Vérifications post-Phase 1

```bash
# La lib est bien créée
ls -la lib/prompting/
# 5 modules + types + README

# Aucun import orphelin
grep -rn "from '@/lib/prompting'" app/ components/ lib/
# au moins 1 résultat (un module qui s'importe lui-même via tests OK)

# Tests verts
pnpm test lib/prompting/
```

---

## PHASE 2 — CANCELLATION BIDDINGCOPILOT

### 2.1 Suppressions

Conformément au plan documenté dans l'audit (`docs/chantier_a4_5_audit_prompting_existant.md` Partie 2.3) :

```bash
# Suppression
rm app/map/analyse/digital/_components/BiddingCopilot.tsx
rm app/api/digital/[campaignId]/bidding-chat/route.ts

# Cleanup imports
# Dans AnalysisPanel.tsx :
# - DELETE ligne 11 : import { BiddingCopilot }
# - DELETE ligne 320 : <BiddingCopilot ... />
# - DELETE ligne 50 : copilotEnabled state si inutilisé après cleanup
```

### 2.2 Vérifications post-Phase 2

```bash
# Aucune référence orpheline
grep -rn "BiddingCopilot" app/ components/ lib/
# ATTENDU : 0 résultat

grep -rn "bidding-chat" app/ components/ lib/
# ATTENDU : 0 résultat (sauf historique dans docs/)

# Module Campagne Média toujours fonctionnel
# Test browser : aller sur /map/analyse/digital, vérifier qu'AnalysisPanel s'affiche sans crash
```

### 2.3 Commit Phase 2

```
chore(prompting): A4.5 phase 2 — cancel BiddingCopilot, patterns extracted to lib/prompting/

- Remove BiddingCopilot.tsx (402 lines) and bidding-chat route (252 lines)
- Cleanup AnalysisPanel.tsx: 3 lines removed
- All reusable patterns now live in lib/prompting/ (cf phase 1)
- 0 orphan import, 0 dangling reference
- AnalysisPanel still functional (T-regression OK)
```

---

## PHASE 3 — MIGRATIONS DB

### 3.1 Migration `chantier_a4_5_agent_foundation.sql`

#### 3.1.1 Table `agent_autonomy_settings`

```sql
CREATE TABLE public.agent_autonomy_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Scope du setting
  scope_type TEXT NOT NULL CHECK (scope_type IN ('user_default', 'strategy_override')),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_id UUID REFERENCES public.bidding_strategies(id) ON DELETE CASCADE,
  
  -- Niveau d'autonomie (0 à 4)
  autonomy_level INT NOT NULL CHECK (autonomy_level BETWEEN 0 AND 4),
  -- 0 = Observer (l'agent ne fait rien tout seul, répond seulement quand on lui demande)
  -- 1 = Explainer (notifications proactives mais aucune action)
  -- 2 = Suggester (propose des actions concrètes avec validation manuelle)
  -- 3 = Auto-low-risk (agit seul sur low-risk : alerts, logs, retrain ; demande validation pour le reste)
  -- 4 = Auto-full (agit seul partout)
  
  -- Configuration fine
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- ex: { "notify_email": true, "notify_slack": false, "low_risk_actions": ["log","alert"] }
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Contraintes cohérence
  CONSTRAINT aas_scope_consistency CHECK (
    (scope_type = 'user_default' AND user_id IS NOT NULL AND strategy_id IS NULL)
    OR (scope_type = 'strategy_override' AND strategy_id IS NOT NULL)
  ),
  
  UNIQUE (user_id, strategy_id, scope_type)
);

CREATE INDEX idx_aas_user ON public.agent_autonomy_settings(user_id) 
  WHERE scope_type = 'user_default';
CREATE INDEX idx_aas_strategy ON public.agent_autonomy_settings(strategy_id) 
  WHERE scope_type = 'strategy_override';

CREATE TRIGGER tr_aas_updated 
  BEFORE UPDATE ON public.agent_autonomy_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.agent_autonomy_settings IS 
  'Niveau d''autonomie de l''agent IA, configurable par user (default) ou par stratégie (override). 5 niveaux 0-4.';
```

#### 3.1.2 Table `bidding_agent_actions` (audit trail)

```sql
CREATE TABLE public.bidding_agent_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Contexte de l'action
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  strategy_id UUID REFERENCES public.bidding_strategies(id) ON DELETE CASCADE,
  drift_event_id UUID REFERENCES public.bidding_drift_events(id) ON DELETE SET NULL,
  
  -- Détail
  intent TEXT NOT NULL,
  -- ex: 'analyze_drift', 'explain_decision', 'apply_recommendation', etc.
  
  trigger_source TEXT NOT NULL CHECK (trigger_source IN ('user_chat', 'proactive', 'api')),
  
  -- Input + Output
  user_message TEXT,
  agent_response TEXT,
  recommendations JSONB DEFAULT '[]'::jsonb,
  -- ex: [{ "type": "increase_ceiling_bid", "params": {"postal_code": "75001", "factor": 1.15}, "reasoning": "..." }]
  
  -- Statut de l'action
  action_taken TEXT CHECK (action_taken IN (
    'none',           -- l'agent a juste répondu (niveau 0/1)
    'suggested',      -- proposition affichée (niveau 2)
    'auto_applied',   -- l'agent a agi (niveau 3/4)
    'human_approved', -- humain a validé une suggestion
    'human_rejected'  -- humain a rejeté
  )),
  applied_at TIMESTAMPTZ,
  
  -- Métadonnées techniques
  llm_model TEXT,                    -- 'gemini-2.5-flash'
  llm_tokens_input INT,
  llm_tokens_output INT,
  llm_duration_ms INT,
  autonomy_level_at_time INT,        -- snapshot du level au moment de l'action
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_baa_user ON public.bidding_agent_actions(user_id, created_at DESC);
CREATE INDEX idx_baa_strategy ON public.bidding_agent_actions(strategy_id, created_at DESC);
CREATE INDEX idx_baa_drift ON public.bidding_agent_actions(drift_event_id) 
  WHERE drift_event_id IS NOT NULL;
CREATE INDEX idx_baa_intent ON public.bidding_agent_actions(intent, created_at DESC);

COMMENT ON TABLE public.bidding_agent_actions IS 
  'Audit trail complet des interactions agent ↔ user et des actions automatiques. Conformité + debug + analytics.';
```

#### 3.1.3 Colonne additive sur `bidding_drift_events`

```sql
ALTER TABLE public.bidding_drift_events
  ADD COLUMN IF NOT EXISTS agent_recommendation JSONB,
  ADD COLUMN IF NOT EXISTS agent_analyzed_at TIMESTAMPTZ;

-- Pour traquer quels drifts l'agent a déjà analysés (éviter doublons)
CREATE INDEX IF NOT EXISTS idx_bde_unanalyzed 
  ON public.bidding_drift_events(detected_at) 
  WHERE agent_analyzed_at IS NULL;

COMMENT ON COLUMN public.bidding_drift_events.agent_recommendation IS 
  'Recommandation structurée de l''agent IA pour ce drift event (raisonnement + actions proposées).';
```

### 3.2 RLS

Pattern standard GEOMATIK avec `get_user_role()` :
- `agent_autonomy_settings` : SELECT/UPDATE/INSERT/DELETE par owner ou admin
- `bidding_agent_actions` : SELECT par owner ou admin, INSERT par service_role only (pas de tampering user)

### 3.3 Vérifications post-Phase 3

```sql
-- Tables créées
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('agent_autonomy_settings', 'bidding_agent_actions');
-- ATTENDU : 2 lignes

-- Colonnes ajoutées
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'bidding_drift_events' 
  AND column_name IN ('agent_recommendation', 'agent_analyzed_at');
-- ATTENDU : 2 lignes

-- Adform legacy strict
SELECT COUNT(*) FROM dsp_campaign_data 
WHERE campaign_id IN (SELECT id FROM dsp_campaigns WHERE is_demo = false);
-- ATTENDU : 294135
```

---

## PHASE 4 — BACKEND AGENT

### 4.1 Architecture cible

```
app/api/agent/
├── chat/route.ts                       # POST: streaming chat principal
├── analyze-drift/route.ts              # POST: analyse proactive d'un drift
├── apply-recommendation/route.ts       # POST: applique une reco (avec checks autonomie)
├── settings/
│   ├── route.ts                        # GET/PATCH user defaults
│   └── strategy/[id]/route.ts          # GET/PATCH override par stratégie
└── history/route.ts                    # GET: audit trail récent

lib/agent/
├── orchestrator.ts                     # Routeur intent → handler
├── intents/
│   ├── index.ts                        # Registry pluggable des intents
│   ├── analyze_drift.ts                # P1
│   ├── explain_decision.ts             # P2
│   ├── query_data.ts                   # P3
│   ├── recommend_action.ts             # P4
│   ├── create_strategy.ts              # P5
│   ├── compare_campaigns.ts            # P6
│   ├── navigate.ts                     # P7
│   ├── generate_report.ts              # P8
│   └── detect_anomaly.ts               # P9
├── tools/                              # Tool calling Vercel AI SDK
│   ├── index.ts                        # Registry pluggable des tools
│   ├── get_strategy.ts
│   ├── list_drift_events.ts
│   ├── get_campaign_stats.ts
│   ├── get_zone_multipliers.ts
│   ├── trigger_modal_predict.ts
│   ├── apply_bid_change.ts
│   └── ... (extensible)
├── system-prompts/
│   ├── base.ts                         # Identité de base de l'agent
│   ├── drift-analysis.ts               # Spécialisation drift
│   └── recommendation.ts               # Spécialisation reco
├── autonomy.ts                         # Vérification + enforcement des niveaux
└── types.ts
```

### 4.2 Intent registry pluggable

```typescript
// lib/agent/intents/index.ts
export interface AgentIntent {
  code: string;                          // ex: 'analyze_drift'
  display_name_fr: string;
  description: string;
  required_context?: string[];           // ex: ['strategy_id', 'drift_event_id']
  handler: (input: IntentInput) => Promise<IntentOutput>;
}

export const INTENT_REGISTRY: Record<string, AgentIntent> = {};

export function registerIntent(intent: AgentIntent) {
  if (INTENT_REGISTRY[intent.code]) {
    throw new Error(`Intent ${intent.code} already registered`);
  }
  INTENT_REGISTRY[intent.code] = intent;
}

// Auto-register au démarrage
import './analyze_drift';
import './explain_decision';
import './query_data';
// ... etc.
```

Chaque fichier `lib/agent/intents/<intent>.ts` :

```typescript
import { registerIntent } from './index';

registerIntent({
  code: 'analyze_drift',
  display_name_fr: 'Analyser un drift',
  description: 'Analyse un drift event détecté et formule une recommandation',
  required_context: ['drift_event_id'],
  handler: async (input) => {
    // logique métier
  },
});
```

### 4.3 Orchestrator

```typescript
// lib/agent/orchestrator.ts
export async function handleAgentRequest(req: AgentRequest): Promise<AgentResponse> {
  // 1. Auth
  const session = await getSession();
  if (!session) throw new Error('Unauthorized');
  
  // 2. Détection intent (via Gemini Flash en premier appel)
  const intent = await detectIntent(req.message, req.context);
  
  // 3. Lookup handler
  const intentDef = INTENT_REGISTRY[intent.code];
  if (!intentDef) {
    return fallbackToGeneralChat(req); // au cas où, on fallback sur le chat copilote
  }
  
  // 4. Vérifier le niveau d'autonomie
  const autonomyLevel = await getAutonomyLevel({
    user_id: session.user.id,
    strategy_id: req.context.strategy_id,
  });
  
  // 5. Appeler le handler
  const result = await intentDef.handler({
    user: session.user,
    context: req.context,
    autonomy_level: autonomyLevel,
    message: req.message,
  });
  
  // 6. Enforcement actions selon autonomyLevel
  if (result.proposed_actions?.length > 0) {
    await enforceAutonomy(result.proposed_actions, autonomyLevel);
  }
  
  // 7. Audit trail
  await logToAuditTrail({
    user_id: session.user.id,
    intent: intent.code,
    user_message: req.message,
    agent_response: result.response_text,
    recommendations: result.proposed_actions,
    action_taken: result.action_status,
    autonomy_level_at_time: autonomyLevel,
    llm_model: 'gemini-2.5-flash',
    llm_tokens_input: result.tokens_in,
    llm_tokens_output: result.tokens_out,
    llm_duration_ms: result.duration_ms,
  });
  
  return result;
}
```

### 4.4 Système d'autonomie (enforcement backend)

```typescript
// lib/agent/autonomy.ts

export type AutonomyLevel = 0 | 1 | 2 | 3 | 4;

export interface ProposedAction {
  type: 'apply_bid_change' | 'pause_strategy' | 'retrain_model' | 'send_alert' | 'log_event';
  risk: 'low' | 'medium' | 'high';
  params: Record<string, unknown>;
  reasoning: string;
}

export async function enforceAutonomy(
  actions: ProposedAction[], 
  level: AutonomyLevel
): Promise<{ applied: ProposedAction[], suggested: ProposedAction[] }> {
  
  switch (level) {
    case 0: // Observer
    case 1: // Explainer
      return { applied: [], suggested: [] };
    
    case 2: // Suggester
      return { applied: [], suggested: actions };
    
    case 3: // Auto-low-risk
      const lowRisk = actions.filter(a => a.risk === 'low');
      const others = actions.filter(a => a.risk !== 'low');
      const applied = await Promise.all(lowRisk.map(applyAction));
      return { applied, suggested: others };
    
    case 4: // Auto-full
      const all = await Promise.all(actions.map(applyAction));
      return { applied: all, suggested: [] };
  }
}

async function applyAction(action: ProposedAction): Promise<ProposedAction> {
  // Switch sur action.type → exécution
  switch (action.type) {
    case 'apply_bid_change':
      // UPDATE bidding_zone_configs
      ...
    case 'retrain_model':
      // Appel Modal /train
      ...
    // etc.
  }
}
```

### 4.5 Handler P1 — `analyze_drift` (priorité absolue V1)

C'est **le** handler du pitch. Spec détaillée :

```typescript
// lib/agent/intents/analyze_drift.ts
import { registerIntent } from './index';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';

registerIntent({
  code: 'analyze_drift',
  display_name_fr: 'Analyser un drift',
  description: 'Analyse un drift event détecté et formule une recommandation',
  required_context: ['drift_event_id'],
  handler: async ({ user, context, autonomy_level, message }) => {
    
    // 1. Charger le drift event + le contexte campagne
    const drift = await loadDriftEvent(context.drift_event_id);
    const strategy = await loadStrategy(drift.strategy_id);
    const campaign = await loadCampaign(strategy.campaign_id);
    const recentPerf = await loadRecentPerformance(strategy.id, 14); // 14 derniers jours
    
    // 2. Construire le system prompt
    const systemPrompt = buildDriftAnalysisPrompt({
      drift,
      strategy,
      campaign,
      recentPerf,
      autonomy_level,
    });
    
    // 3. Appel Gemini Flash (D1 validé : pas de Pro pour V1)
    const t0 = Date.now();
    const response = await generateText({
      model: google('gemini-2.5-flash'),
      system: systemPrompt,
      prompt: message || `Analyse le drift event ${drift.id} et recommande une action.`,
      temperature: 0.4,
    });
    const duration = Date.now() - t0;
    
    // 4. Parse JSON structuré (utiliser lib/prompting/json-extraction)
    const parsed = extractJSON<DriftAnalysisOutput>(response.text);
    
    // 5. Mettre à jour bidding_drift_events.agent_recommendation
    await updateDriftEvent(drift.id, {
      agent_recommendation: parsed,
      agent_analyzed_at: new Date(),
    });
    
    // 6. Construire la réponse
    return {
      response_text: parsed.summary_french,
      proposed_actions: parsed.proposed_actions || [],
      action_status: 'none', // sera mis à jour par enforceAutonomy
      tokens_in: response.usage?.promptTokens,
      tokens_out: response.usage?.completionTokens,
      duration_ms: duration,
    };
  },
});
```

### 4.6 System prompt drift-analysis

```typescript
// lib/agent/system-prompts/drift-analysis.ts
export function buildDriftAnalysisPrompt(ctx: {
  drift: BiddingDriftEvent;
  strategy: BiddingStrategy;
  campaign: DspCampaign;
  recentPerf: PerfDataPoint[];
  autonomy_level: AutonomyLevel;
}): string {
  return `
Tu es **GeoAgent**, l'agent IA superviseur de GEOMATIK, plateforme de Custom Bidding ML pour campagnes DSP.

# Ton rôle
Tu analyses les drift events détectés par l'algo Hoeffding pour la stratégie "${ctx.strategy.name}" 
sur la campagne "${ctx.campaign.name}".

Tu raisonnes comme un expert media planner doublé d'un data scientist : tu croises les chiffres, 
le contexte business, et tu formules une recommandation **claire, actionnable, en français**.

# Contexte drift event
- ID drift : ${ctx.drift.id}
- Détecté le : ${ctx.drift.detected_at}
- Type : ${ctx.drift.drift_type}
- Sévérité : ${ctx.drift.severity}
- Zone affectée : ${ctx.drift.postal_code ?? 'global stratégie'}
- Métrique avant : ${JSON.stringify(ctx.drift.metric_before)}
- Métrique après : ${JSON.stringify(ctx.drift.metric_after)}
- Delta : ${ctx.drift.delta}%
- Description : ${ctx.drift.description}

# Performance récente (14 derniers jours)
${formatPerfData(ctx.recentPerf)}

# Niveau d'autonomie courant
${ctx.autonomy_level} (${getAutonomyLabel(ctx.autonomy_level)})

# Actions disponibles que tu peux proposer
- apply_bid_change : modifier le bid_multiplier d'une zone (risque: low si delta < 20%, medium au-delà)
- pause_strategy : mettre en pause toute la stratégie (risque: high)
- retrain_model : déclencher Modal /train (risque: low)
- send_alert : notifier un humain (risque: low)
- log_event : juste enregistrer (risque: low)

# Format de réponse OBLIGATOIRE
Tu réponds **uniquement** en JSON valide, dans un bloc \`\`\`json :

\`\`\`json
{
  "summary_french": "Résumé en 2-3 phrases en français pour le planner",
  "diagnosis": {
    "likely_causes": ["...", "..."],
    "confidence": "high|medium|low",
    "data_evidence": "..."
  },
  "proposed_actions": [
    {
      "type": "apply_bid_change",
      "risk": "low",
      "params": { "postal_code": "75001", "new_multiplier": 1.5 },
      "reasoning": "Pourquoi cette action en 1 phrase"
    }
  ],
  "next_check_at": "2026-04-30T14:00:00Z"
}
\`\`\`

# Règles de raisonnement
1. Sois conservateur : si tu doutes, propose 'send_alert' plutôt qu'une action automatique
2. Ne propose jamais une action high-risk si autonomy_level >= 3 et tu ne peux pas justifier rigoureusement
3. Croise toujours metric_after vs recentPerf pour confirmer le drift n'est pas un faux positif
4. En cas de drift saisonnier connu (weekend, fin de mois), mentionne-le explicitement
5. Réponds en français, ton professionnel mais pas robotique
`;
}
```

### 4.7 Détection d'intent

Pour V1, on garde simple :

```typescript
// lib/agent/orchestrator.ts (extrait)
async function detectIntent(message: string, context: AgentContext): Promise<DetectedIntent> {
  // 1. Si context contient drift_event_id, c'est probablement analyze_drift (priorité)
  if (context.drift_event_id) {
    return { code: 'analyze_drift', confidence: 0.95 };
  }
  
  // 2. Sinon, classification Gemini Flash rapide
  const response = await generateText({
    model: google('gemini-2.5-flash'),
    system: 'Tu classifies les requêtes utilisateur en 1 intent parmi cette liste : ' + 
            Object.keys(INTENT_REGISTRY).join(', ') + 
            '. Réponds UNIQUEMENT par le code intent ou "unknown".',
    prompt: message,
    temperature: 0,
    maxTokens: 50,
  });
  
  const detected = response.text.trim();
  if (INTENT_REGISTRY[detected]) {
    return { code: detected, confidence: 0.8 };
  }
  return { code: 'unknown', confidence: 0 };
}
```

### 4.8 Vérifications post-Phase 4

```bash
# Routes API créées
ls -la app/api/agent/
# ATTENDU : chat/, analyze-drift/, apply-recommendation/, settings/, history/

# Lib agent créée
ls -la lib/agent/
# ATTENDU : orchestrator.ts, intents/, tools/, system-prompts/, autonomy.ts, types.ts

# Test E2E rapide via curl (en dev local)
# (doit être fait par Vince car nécessite npm run dev)
curl -X POST http://localhost:3000/api/agent/analyze-drift \
  -H "Content-Type: application/json" \
  -d '{"drift_event_id":"<ID_drift_existant_db>"}'
# ATTENDU : JSON avec summary_french + proposed_actions
```

---

## PHASE 5 — UI PANEL AGENT

### 5.1 Composant principal

```
app/_components/agent/
├── AgentProvider.tsx              # Context provider (open state, current context)
├── AgentTrigger.tsx               # Bouton dans le header pour ouvrir/fermer le panel
├── AgentPanel.tsx                 # Side panel droit (~400px wide)
├── AgentMessageList.tsx           # Liste des messages (réutilise lib/prompting/chat-ui/)
├── AgentInput.tsx                 # Zone de saisie + enter to send
├── AgentRecommendationCard.tsx    # Carte d'une recommandation (avec boutons Apply/Reject selon autonomie)
└── AgentAutonomyBadge.tsx         # Petit badge qui montre le niveau d'autonomie courant
```

### 5.2 Intégration dans le layout

Modifier `app/layout.tsx` (ou `app/_components/Layout.tsx` selon arch) :

```tsx
<AgentProvider>
  <Sidebar />
  <main>{children}</main>
  <AgentPanel />
</AgentProvider>
```

`AgentTrigger` est ajouté dans le header avec une icône (lucide `Sparkles` ou `Bot`) :
- État fermé : icône simple
- État ouvert : icône avec petit point teal
- Si une notification proactive en attente : badge rouge

### 5.3 Context awareness

Quand le panel s'ouvre depuis la page `/custom-bidding/[strategyId]`, il récupère automatiquement le `strategy_id` du contexte de la page. Pareil pour les drift events :

```tsx
// Sur la page /custom-bidding/[id], dans la timeline des drifts :
<DriftEventMarker 
  drift={drift}
  onClick={() => agent.open({ drift_event_id: drift.id, intent: 'analyze_drift' })}
/>
```

Le panel s'ouvre, l'intent `analyze_drift` est pré-rempli, l'agent commence directement à analyser.

### 5.4 UI des recommandations

```tsx
function AgentRecommendationCard({ recommendation, autonomyLevel }) {
  const canAutoApply = autonomyLevel >= 3 && recommendation.risk === 'low';
  const isAutoApplied = autonomyLevel === 4 || canAutoApply;
  
  return (
    <Card>
      <h4>{recommendation.type}</h4>
      <p>{recommendation.reasoning}</p>
      <Badge>{recommendation.risk}</Badge>
      
      {isAutoApplied ? (
        <Badge variant="success">Auto-applied</Badge>
      ) : (
        <div>
          <Button onClick={apply}>Apply</Button>
          <Button variant="outline" onClick={reject}>Reject</Button>
        </div>
      )}
    </Card>
  );
}
```

### 5.5 Design system

Strict respect `DESIGN_SYSTEM.md` :
- Background panel : `#0a0a0a` (cohérent avec le reste)
- Bordure gauche : `#1a1a1a`
- Accent unique : teal `#4ecdc4`
- Inter pour texte, JetBrains Mono pour code
- Sentence case partout
- Pas de gradient, pas de shadow lourde
- Animations : `transition-all duration-200 ease-out` (pas de spring exagéré)

### 5.6 Vérifications post-Phase 5

Tests browser manuels :
1. Ouvrir n'importe quelle page → bouton agent visible dans le header
2. Cliquer → panel droit s'ouvre, animation fluide
3. Aller sur `/custom-bidding/<demo>` → cliquer sur un drift event → panel s'ouvre avec analyse en cours
4. La réponse de l'agent s'affiche en français, avec la recommandation et le bouton Apply
5. Cliquer Apply → action exécutée, audit trail enregistré

---

## PHASE 6 — SYSTÈME D'AUTONOMIE (UI SETTINGS)

### 6.1 Page settings

```
app/settings/agent/
├── page.tsx                        # Settings globaux user
└── _components/
    ├── AutonomyLevelSelector.tsx   # 5 cards (Observer/Explainer/Suggester/Auto-low/Auto-full)
    ├── NotificationPrefs.tsx       # Email/Slack/in-app
    └── ActionRiskMatrix.tsx        # Visualisation : pour chaque type d'action × risque, qui décide
```

### 6.2 Override par stratégie

Sur la page `/custom-bidding/[strategyId]`, ajouter dans le `StrategyHeader` :

```tsx
<AutonomyLevelOverride 
  strategyId={strategy.id}
  currentLevel={strategy.agent_autonomy_override ?? userDefault}
  inheritedFrom={userDefault}
/>
```

Permet de surcharger le niveau pour cette stratégie spécifique. Si aucun override : utilise le default user.

### 6.3 Visualisation claire des 5 niveaux

```tsx
const AUTONOMY_LEVELS = [
  { 
    level: 0, 
    name: 'Observer', 
    description: 'L\'agent ne fait rien tout seul. Il répond uniquement quand vous le sollicitez.',
    icon: Eye,
  },
  { 
    level: 1, 
    name: 'Explainer', 
    description: 'L\'agent peut envoyer des notifications proactives mais ne prend aucune action.',
    icon: Bell,
  },
  { 
    level: 2, 
    name: 'Suggester', 
    description: 'L\'agent propose des actions concrètes. Vous validez chacune avant exécution.',
    icon: Lightbulb,
  },
  { 
    level: 3, 
    name: 'Auto low-risk', 
    description: 'L\'agent agit seul sur les actions à faible risque (logs, alertes, ré-entraînement). Validation requise pour le reste.',
    icon: Zap,
  },
  { 
    level: 4, 
    name: 'Full auto', 
    description: 'L\'agent agit seul sur toutes les actions, y compris haut risque. À utiliser avec précaution.',
    icon: Bot,
  },
];
```

### 6.4 Vérifications post-Phase 6

- Page `/settings/agent` charge le current setting (default 2 = Suggester si non défini)
- Sélection d'un niveau → PATCH route → persisté
- Page `/custom-bidding/[id]` montre l'override possible
- Le backend `enforceAutonomy()` lit bien le bon niveau (test avec un drift_event)

---

## PHASE 7 — TESTS E2E + VALIDATION

### 7.1 Tests fonctionnels

**T1** — Cancel BiddingCopilot
- AnalysisPanel charge sans crash sur les 4 campagnes Adform et la démo Renault
- 0 référence orpheline `BiddingCopilot` dans le code

**T2** — Lib prompting extraite
- `lib/prompting/` contient les 5 modules + tests verts
- L'agent A4.5 importe bien depuis `lib/prompting/`

**T3** — Schéma DB
- 2 nouvelles tables créées avec RLS
- 2 colonnes ajoutées à `bidding_drift_events`
- Adform legacy strict (4 / 294 135 / 172 056 383)

**T4** — Backend agent (`/api/agent/analyze-drift`)
- Appel sur un drift event existant → réponse JSON valide en français
- Recommandation structurée présente
- Audit trail row créée dans `bidding_agent_actions`
- `bidding_drift_events.agent_recommendation` mis à jour

**T5** — UI panel
- Bouton agent visible dans le header de toutes les pages
- Panel s'ouvre, animation fluide
- Click sur drift event de `/custom-bidding/<demo>` → panel ouvert avec analyse pré-remplie
- Recommandation affichée avec boutons Apply/Reject

**T6** — Autonomie
- Page `/settings/agent` accessible
- Sélection niveau → persisté en base
- Override par stratégie fonctionne
- Backend respecte le niveau (testé avec niveau 0 → aucune action automatique)

**T7** — Audit trail
- Toutes les interactions agent sont loggées dans `bidding_agent_actions`
- Page `/api/agent/history` retourne les 50 dernières actions

**T8** — Adform regression
- Campagnes Adform : aucun bouton agent spécifique CB visible (cohérent avec l'éligibilité DSP)
- Pas de crash sur les pages Adform avec le panel agent ouvert

**T9** — Smart-prompt et `/api/chat` intacts
- `/api/smart-prompt` route répond comme avant
- `/api/chat` route répond comme avant
- Pas de conflit de routing

### 7.2 Tests de pitch (scénario démo)

**Scénario 1 : Drift analysis flow**
1. Vince ouvre `/custom-bidding/<demo>`
2. Voit un drift event sur la timeline
3. Click → panel agent s'ouvre, analyse en cours (~3-5s)
4. Réponse en français : *"Drift détecté sur les zones rurales le 16 mars, probablement lié à une intensification concurrentielle. Recommandation : réduire le ceiling_bid de 15% sur les CPs concernés."*
5. Bouton "Apply" cliqué (en mode Suggester) → action exécutée → multipliers mis à jour
6. Audit trail visible

**Scénario 2 : Configuration autonomie**
1. Vince va sur `/settings/agent`
2. Voit les 5 niveaux avec descriptions claires
3. Choisit "Auto low-risk" pour son default user
4. Va sur `/custom-bidding/<demo>` → override possible visible
5. Configure cette stratégie en "Suggester" (override)
6. Vérifie que les actions futures suivent ce niveau

---

## DÉLIVRABLES FINAUX

### Code
1. **`lib/prompting/`** : 5 modules + tests + README
2. **BiddingCopilot supprimé** + AnalysisPanel cleanup
3. **2 migrations DB** : `agent_autonomy_settings`, `bidding_agent_actions`, colonnes additives
4. **`app/api/agent/`** : 5 routes (chat, analyze-drift, apply-recommendation, settings, history)
5. **`lib/agent/`** : orchestrator + 9 intents + tools + system prompts + autonomy
6. **`app/_components/agent/`** : 7 composants UI
7. **`app/settings/agent/`** : page + sous-composants

### Doc
- `docs/chantier_a4_5_supervisor_agent.md` : architecture + procédures + comment ajouter un nouvel intent

### Commits atomiques par phase
1. `chore(prompting): A4.5 phase 1 — extract reusable patterns to lib/prompting/`
2. `chore(prompting): A4.5 phase 2 — cancel BiddingCopilot`
3. `feat(agent-db): A4.5 phase 3 — schema for autonomy settings + audit trail`
4. `feat(agent-backend): A4.5 phase 4 — orchestrator + 9 pluggable intents (analyze_drift V1 priority)`
5. `feat(agent-ui): A4.5 phase 5 — side panel + context-aware integration`
6. `feat(agent-autonomy): A4.5 phase 6 — 5-level autonomy with user/strategy overrides`
7. `test(agent): A4.5 phase 7 — E2E tests + pitch scenarios validated`

---

## MÉTHODOLOGIE GLOBALE

### Découpage en sub-agents (parallel)

`@dispatching-parallel-agents` :

**Phase 1+2** (parallèle) :
- Sub-agent A : extraction lib/prompting/ (5 modules)
- Sub-agent B : cleanup BiddingCopilot
- Sub-agent C : tests unitaires lib/prompting/

**Phase 3** (sequential, court) :
- Migration unique appliquée via MCP

**Phase 4** (parallèle) :
- Sub-agent A : orchestrator + autonomy enforcement
- Sub-agent B : intent registry + 9 handlers (priorité analyze_drift)
- Sub-agent C : tools registry + 6-8 tools
- Sub-agent D : system prompts
- Sub-agent E : routes API agent

**Phase 5** (parallèle) :
- Sub-agent A : AgentProvider + Trigger + Panel
- Sub-agent B : Message components + recommendations
- Sub-agent C : intégration dans layout + context awareness

**Phase 6** (sequential, court) :
- Page settings + override

**Phase 7** (sequential) :
- Tous les tests E2E

### Commit policy

1 commit atomique **par phase**. Pas de méga commit final. Permet à Vince de tester chaque phase en isolation et de faire un revert ciblé si une phase casse quelque chose.

### Code review interne

À chaque phase, auto-review focus :
- ✅ RIEN HARDCODÉ (intents, tools, autonomy levels accessibles via registry/DB)
- ✅ Forbidden zones intactes
- ✅ Adform legacy strict
- ✅ DESIGN_SYSTEM respecté
- ✅ Audit trail systématique pour toute interaction agent

---

## POST-LIVRAISON

Après les 7 commits, `@cleanup-geomatik` Partie 2 + 3 sur les fichiers modifiés.

Indications pour Vince :

1. **Tester le scénario pitch** :
   - Aller sur `/custom-bidding/<demo>`
   - Cliquer sur un drift event de la timeline
   - Vérifier que l'agent analyse en français
   - Tester Apply/Reject

2. **Configurer son niveau d'autonomie** :
   - Aller sur `/settings/agent`
   - Choisir le niveau qu'il veut par défaut

3. **Pour le pitch lundi** :
   - Importer ses vraies campagnes (cf chantier d'import existant)
   - Activer Custom Bidding via le modal A4.4.5
   - Lancer Modal `/predict` puis `/detect-drift` sur chaque
   - L'agent prendra le relais automatiquement

---

## RÉSUMÉ EN UNE LIGNE

GeoAgent — agent IA superviseur multi-intents pluggables (9 cas d'usage, V1 prio drift analysis), 5 niveaux d'autonomie configurables par user et par stratégie, side panel context-aware, audit trail complet, basé sur Gemini 2.5 Flash + lib/prompting/ partagée extraite de BiddingCopilot avant cancel — **le différenciant pitch ultime** vs CARTO/MyTraffic/Gini.