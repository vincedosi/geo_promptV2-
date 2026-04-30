/**
 * Intent V1 prioritaire : analyze_drift.
 * Charge un drift event + son contexte, appelle Gemini Flash, parse le JSON
 * structuré et retourne IntentOutput.
 */
import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { createAdminClient } from '@/lib/auth';
import { extractJSON } from '@/lib/prompting';
import { registerIntent } from './index';
import { buildDriftAnalysisPrompt } from '../system-prompts/drift-analysis';
import type { AgentIntent, DriftAnalysisOutput, IntentInput, IntentOutput, ProposedAction } from '../types';

const intent: AgentIntent = {
  code: 'analyze_drift',
  display_name_fr: 'Analyser un drift',
  description: 'Analyse un drift event détecté et formule une recommandation structurée.',
  required_context: ['drift_event_id'],
  handler: async (input: IntentInput): Promise<IntentOutput> => {
    const driftId = input.context.drift_event_id;
    if (!driftId) {
      return errorOutput('drift_event_id manquant dans le context');
    }
    const supabase = createAdminClient();

    // 1. Drift event
    const { data: drift, error: dErr } = await supabase
      .from('bidding_drift_events')
      .select('id,strategy_id,detected_at,drift_type,severity,postal_code,country_code,metric_before,metric_after,delta,description')
      .eq('id', driftId)
      .single();
    if (dErr || !drift) {
      return errorOutput(`Drift event introuvable (${driftId})`);
    }

    // 2. Strategy + campaign
    const { data: strategy } = await supabase
      .from('bidding_strategies')
      .select('id,name,algorithm_code,campaign_id')
      .eq('id', drift.strategy_id)
      .single();
    if (!strategy) {
      return errorOutput(`Stratégie introuvable pour ce drift`);
    }

    const { data: campaign } = await supabase
      .from('dsp_campaigns')
      .select('id,name')
      .eq('id', strategy.campaign_id)
      .single();
    const campaignName = campaign?.name ?? 'Campagne inconnue';

    // 3. Performance récente (14 derniers jours, agrégat journalier)
    const { data: dailyRows } = await supabase
      .from('bidding_daily_state')
      .select('date,impressions,clicks,conversions,spend,metrics')
      .eq('strategy_id', drift.strategy_id)
      .order('date', { ascending: false })
      .limit(14);
    const recent_perf = (dailyRows ?? []).map(r => ({
      date: String(r.date),
      leads: Number(r.conversions ?? 0),
      spend: Number(r.spend ?? 0),
      impressions: Number(r.impressions ?? 0),
    })).reverse();

    // 4. Construction prompt + appel Gemini
    const systemPrompt = buildDriftAnalysisPrompt({
      drift: {
        id: drift.id,
        detected_at: drift.detected_at,
        drift_type: drift.drift_type,
        severity: drift.severity,
        postal_code: drift.postal_code,
        metric_before: drift.metric_before,
        metric_after: drift.metric_after,
        delta: drift.delta,
        description: drift.description,
      },
      strategy: { name: strategy.name, algorithm_code: strategy.algorithm_code },
      campaign: { name: campaignName },
      recent_perf,
      autonomy_level: input.autonomy_level,
    });

    const userMessage = input.message
      || `Analyse le drift event ${drift.id} et recommande une action.`;

    const t0 = Date.now();
    let text = '';
    let tokens_in: number | undefined;
    let tokens_out: number | undefined;
    try {
      const result = await generateText({
        model: google('gemini-2.5-flash'),
        system: systemPrompt,
        prompt: userMessage,
        temperature: 0.4,
        providerOptions: {
          google: { thinkingConfig: { thinkingBudget: 0 } },
        },
      });
      text = result.text;
      tokens_in = result.usage?.inputTokens;
      tokens_out = result.usage?.outputTokens;
    } catch (e) {
      console.error('[agent.analyze_drift] LLM error', e);
      return errorOutput(`Erreur LLM : ${(e as Error).message}`);
    }
    const duration_ms = Date.now() - t0;

    // 5. Parse JSON structuré
    const parsed = extractJSON<DriftAnalysisOutput>(text);
    if (!parsed) {
      return {
        response_text: text,
        proposed_actions: [],
        action_status: 'none',
        tokens_in,
        tokens_out,
        duration_ms,
      };
    }

    // 6. Update bidding_drift_events.agent_recommendation
    await supabase
      .from('bidding_drift_events')
      .update({
        agent_recommendation: parsed,
        agent_analyzed_at: new Date().toISOString(),
      })
      .eq('id', drift.id);

    return {
      response_text: parsed.summary_french || text,
      proposed_actions: (parsed.proposed_actions ?? []) as ProposedAction[],
      action_status: 'none',
      tokens_in,
      tokens_out,
      duration_ms,
    };
  },
};

function errorOutput(msg: string): IntentOutput {
  return {
    response_text: msg,
    proposed_actions: [],
    action_status: 'none',
  };
}

registerIntent(intent);
export default intent;
