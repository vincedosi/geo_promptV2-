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

    // 1. Drift event (avec agent_recommendation potentiellement déjà pré-écrit)
    const { data: drift, error: dErr } = await supabase
      .from('bidding_drift_events')
      .select('id,strategy_id,detected_at,drift_type,severity,postal_code,country_code,metric_before,metric_after,delta,description,agent_recommendation')
      .eq('id', driftId)
      .single();
    if (dErr || !drift) {
      return errorOutput(`Drift event introuvable (${driftId})`);
    }

    // 2. Strategy + campaign
    const { data: strategy } = await supabase
      .from('bidding_strategies')
      .select('id,name,algorithm_code,campaign_id,is_demo')
      .eq('id', drift.strategy_id)
      .single();
    if (!strategy) {
      return errorOutput(`Stratégie introuvable pour ce drift`);
    }

    const { data: campaign } = await supabase
      .from('dsp_campaigns')
      .select('id,name,is_demo')
      .eq('id', strategy.campaign_id)
      .single();
    const campaignName = campaign?.name ?? 'Campagne inconnue';

    // Mode démo : si la stratégie est `is_demo` ET qu'un agent_recommendation
    // pré-écrit existe en DB, on l'utilise directement (zéro appel LLM).
    // Garantit la prévisibilité totale pendant un pitch — aucun risque réseau,
    // aucune dépendance quota Gemini, latence simulée 1.2s pour le réalisme.
    const isDemo = Boolean(strategy.is_demo) || Boolean(campaign?.is_demo);
    const preWritten = drift.agent_recommendation as Record<string, unknown> | null;
    if (isDemo && preWritten && (preWritten.action || preWritten.summary_french || preWritten.rationale)) {
      // Délai artificiel pour le ressenti "l'agent réfléchit"
      await new Promise(resolve => setTimeout(resolve, 1200));
      return buildDemoOutputFromPreWritten(preWritten, drift.postal_code as string | null);
    }

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

/**
 * Formate l'agent_recommendation pré-écrit (mode démo) en sortie d'intent.
 * Le pré-écrit suit la convention du seed : { action, reduce_zones, reduce_pct,
 * boost_zones, boost_pct, projection_14d, rationale }.
 */
function buildDemoOutputFromPreWritten(
  rec: Record<string, unknown>,
  driftZone: string | null,
): IntentOutput {
  const reduceZones = (rec.reduce_zones as string[]) ?? [];
  const boostZones = (rec.boost_zones as string[]) ?? [];
  const reducePct = Number(rec.reduce_pct ?? 0);
  const boostPct = Number(rec.boost_pct ?? 0);
  const proj = (rec.projection_14d as Record<string, unknown>) ?? {};
  const rationale = String(rec.rationale ?? '');

  // Construit un texte de réponse riche en français
  const summaryParts: string[] = [];
  if (driftZone) {
    summaryParts.push(`🔴 **Drift critique détecté sur ${driftZone}.**`);
  }
  if (rationale) summaryParts.push(rationale);
  if (reduceZones.length > 0) {
    summaryParts.push(
      `**Recommandation** : réduire la pression sur ${reduceZones.join(', ')} de **−${reducePct}%**` +
      (boostZones.length > 0 ? ` et redéployer le budget vers ${boostZones.join(', ')} (**+${boostPct}%**).` : '.'),
    );
  }
  if (proj.cpl_global_before && proj.cpl_global_after) {
    summaryParts.push(
      `**Projection à 14 jours** : CPL global ${Number(proj.cpl_global_before).toFixed(2)}€ → **${Number(proj.cpl_global_after).toFixed(2)}€**` +
      (proj.visits_delta_pct ? ` (+${proj.visits_delta_pct}% de visites)` : '') +
      (proj.incremental_visits ? `, soit **${Number(proj.incremental_visits).toLocaleString('fr-FR')} citoyens supplémentaires sensibilisés**.` : '.'),
    );
  }

  const responseText = summaryParts.join('\n\n');

  // Construit les actions proposées dans le format ProposedAction
  const proposedActions: ProposedAction[] = [];
  for (const zone of reduceZones) {
    proposedActions.push({
      type: 'apply_bid_change',
      risk: reducePct > 30 ? 'medium' : 'low',
      params: {
        postal_code: zone,
        bid_multiplier_delta_pct: -reducePct,
      },
      reasoning: `Réduire ${zone} de ${reducePct}% pour soulager la saturation média.`,
    } as ProposedAction);
  }
  for (const zone of boostZones) {
    proposedActions.push({
      type: 'apply_bid_change',
      risk: boostPct > 30 ? 'medium' : 'low',
      params: {
        postal_code: zone,
        bid_multiplier_delta_pct: boostPct,
      },
      reasoning: `Booster ${zone} de ${boostPct}% pour exploiter la marge d'activation disponible.`,
    } as ProposedAction);
  }

  return {
    response_text: responseText,
    proposed_actions: proposedActions,
    action_status: 'none',
    tokens_in: 0,
    tokens_out: 0,
    duration_ms: 1200,
  };
}

registerIntent(intent);
export default intent;
