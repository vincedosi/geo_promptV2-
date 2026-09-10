/**
 * Orchestrateur agent IA superviseur.
 *
 * Pipeline :
 *  1. Auto-load intents (idempotent)
 *  2. Détection d'intent (heuristique simple V1, fallback Gemini si message libre)
 *  3. Lookup handler dans le registry
 *  4. Lecture niveau d'autonomie effectif
 *  5. Appel handler → IntentOutput
 *  6. Enforcement actions selon autonomy_level
 *  7. INSERT audit trail (bidding_agent_actions)
 */
import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { createAdminClient } from '@/lib/auth';
import { enforceAutonomy, getAutonomyLevel } from './autonomy';
import { INTENT_REGISTRY, loadAllIntents } from './intents';
import { toJson } from '@/lib/supabase/rpc-json';
import type {
  ActionStatus, AgentContext, AutonomyLevel, IntentOutput, ProposedAction, TriggerSource,
} from './types';

export interface AgentRequest {
  user_id: string;
  message: string;
  context: AgentContext;
  trigger_source: TriggerSource;
  /** Si fourni, court-circuite la détection d'intent. */
  forced_intent?: string;
}

export interface AgentResponse {
  intent: string;
  response_text: string;
  applied_actions: ProposedAction[];
  suggested_actions: ProposedAction[];
  action_status: ActionStatus;
  audit_id: string | null;
  autonomy_level: AutonomyLevel;
  duration_ms: number;
}

const LLM_MODEL = 'gemini-2.5-flash';

/** Pipeline complet : reçoit une requête utilisateur et retourne la réponse. */
export async function handleAgentRequest(req: AgentRequest): Promise<AgentResponse> {
  const t0 = Date.now();
  await loadAllIntents();

  // 1. Detect intent
  const intentCode = req.forced_intent ?? (await detectIntent(req.message, req.context));
  const intentDef = INTENT_REGISTRY[intentCode];

  // 2. Autonomy level
  const autonomy_level = await getAutonomyLevel({
    user_id: req.user_id,
    strategy_id: req.context.strategy_id,
  });

  // 3. Call handler (or fallback if intent unknown)
  let output: IntentOutput;
  if (!intentDef) {
    output = {
      response_text: `Intent inconnu : « ${intentCode} ». Voici ce que je sais faire : ${Object.values(INTENT_REGISTRY).map(i => i.display_name_fr).join(', ')}.`,
      proposed_actions: [],
      action_status: 'none',
    };
  } else {
    try {
      output = await intentDef.handler({
        user: { id: req.user_id },
        context: req.context,
        autonomy_level,
        message: req.message,
        trigger_source: req.trigger_source,
      });
    } catch (e) {
      console.error(`[agent.orchestrator] intent ${intentCode} threw`, e);
      output = {
        response_text: `Erreur lors de l'exécution de l'intent : ${(e as Error).message}`,
        proposed_actions: [],
        action_status: 'none',
      };
    }
  }

  // 4. Enforcement
  const enforced = await enforceAutonomy(output.proposed_actions, autonomy_level, {
    user_id: req.user_id,
    strategy_id: req.context.strategy_id,
  });
  const action_status: ActionStatus = enforced.applied.length > 0
    ? 'auto_applied'
    : enforced.suggested.length > 0
      ? 'suggested'
      : 'none';

  // 5. Audit trail
  const audit_id = await insertAudit({
    user_id: req.user_id,
    strategy_id: req.context.strategy_id ?? null,
    drift_event_id: req.context.drift_event_id ?? null,
    intent: intentCode,
    trigger_source: req.trigger_source,
    user_message: req.message,
    agent_response: output.response_text,
    recommendations: [...enforced.applied, ...enforced.suggested],
    action_taken: action_status,
    applied_at: enforced.applied.length > 0 ? new Date().toISOString() : null,
    llm_model: LLM_MODEL,
    llm_tokens_input: output.tokens_in ?? null,
    llm_tokens_output: output.tokens_out ?? null,
    llm_duration_ms: output.duration_ms ?? null,
    autonomy_level_at_time: autonomy_level,
  });

  return {
    intent: intentCode,
    response_text: output.response_text,
    applied_actions: enforced.applied,
    suggested_actions: enforced.suggested,
    action_status,
    audit_id,
    autonomy_level,
    duration_ms: Date.now() - t0,
  };
}

/**
 * Détection d'intent heuristique + fallback LLM.
 * Heuristique : si context contient drift_event_id → analyze_drift direct.
 * Sinon : prompt classification Gemini Flash rapide (≤ 50 tokens out).
 */
async function detectIntent(message: string, context: AgentContext): Promise<string> {
  await loadAllIntents();

  if (context.drift_event_id) return 'analyze_drift';

  const intents = Object.keys(INTENT_REGISTRY);
  if (!message.trim()) {
    return intents[0] ?? 'analyze_drift';
  }

  try {
    const result = await generateText({
      model: google(LLM_MODEL),
      system: `Tu classifies une requête utilisateur en 1 intent parmi : ${intents.join(', ')}. Réponds UNIQUEMENT par le code exact d'un intent (sans guillemets, sans phrase) ou "unknown".`,
      prompt: message,
      temperature: 0,
      maxOutputTokens: 30,
      providerOptions: {
        google: { thinkingConfig: { thinkingBudget: 0 } },
      },
    });
    const detected = result.text.trim().split(/\s+/)[0];
    if (intents.includes(detected)) return detected;
  } catch (e) {
    console.warn('[agent.detectIntent] fallback heuristic', e);
  }
  return 'recommend_action'; // fallback raisonnable
}

interface AuditPayload {
  user_id: string;
  strategy_id: string | null;
  drift_event_id: string | null;
  intent: string;
  trigger_source: TriggerSource;
  user_message: string;
  agent_response: string;
  recommendations: ProposedAction[];
  action_taken: ActionStatus;
  applied_at: string | null;
  llm_model: string;
  llm_tokens_input: number | null;
  llm_tokens_output: number | null;
  llm_duration_ms: number | null;
  autonomy_level_at_time: AutonomyLevel;
}

async function insertAudit(payload: AuditPayload): Promise<string | null> {
  const supabase = createAdminClient();
  try {
    const { data, error } = await supabase
      .from('bidding_agent_actions')
      .insert({ ...payload, recommendations: toJson(payload.recommendations) })
      .select('id')
      .single();
    if (error) {
      console.error('[agent.insertAudit]', error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (e) {
    console.error('[agent.insertAudit] threw', e);
    return null;
  }
}
