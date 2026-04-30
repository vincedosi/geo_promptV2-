/**
 * System prompt spécialisé : analyse d'un drift event.
 * Construit dynamiquement à partir du drift, de la stratégie, de la perf récente
 * et du niveau d'autonomie courant. Le LLM doit répondre en JSON strict.
 */
import { buildSystemPrompt } from '@/lib/prompting/system-prompt-builder';
import { AGENT_IDENTITY, AGENT_RULES_GENERIC } from './base';
import { AUTONOMY_LABELS, type AutonomyLevel } from '../types';

export interface DriftAnalysisContext {
  drift: {
    id: string;
    detected_at: string;
    drift_type: string;
    severity: string;
    postal_code: string | null;
    metric_before: unknown;
    metric_after: unknown;
    delta: number | null;
    description: string | null;
  };
  strategy: { name: string; algorithm_code: string };
  campaign: { name: string };
  recent_perf?: Array<{
    date: string;
    leads: number;
    spend: number;
    impressions: number;
  }>;
  autonomy_level: AutonomyLevel;
}

export function buildDriftAnalysisPrompt(ctx: DriftAnalysisContext): string {
  const perfLines = (ctx.recent_perf ?? [])
    .slice(-14)
    .map(p => `  - ${p.date} : ${p.leads.toLocaleString('fr-FR')} leads, ${p.spend.toFixed(2)}€ dépensés, ${p.impressions.toLocaleString('fr-FR')} imp.`)
    .join('\n') || '  (aucun point de performance récent disponible)';

  return buildSystemPrompt({
    role: AGENT_IDENTITY + `\n\n## Mission\nTu analyses un drift event détecté par l'algo Hoeffding sur la stratégie « ${ctx.strategy.name} » (campagne « ${ctx.campaign.name} »).`,
    sections: [
      {
        title: 'Drift event',
        body: [
          `- ID : ${ctx.drift.id}`,
          `- Détecté le : ${ctx.drift.detected_at}`,
          `- Type : ${ctx.drift.drift_type}`,
          `- Sévérité : ${ctx.drift.severity}`,
          `- Zone : ${ctx.drift.postal_code ?? 'global stratégie'}`,
          `- Métrique avant : ${JSON.stringify(ctx.drift.metric_before)}`,
          `- Métrique après : ${JSON.stringify(ctx.drift.metric_after)}`,
          `- Delta : ${ctx.drift.delta ?? '?'} %`,
          `- Description : ${ctx.drift.description ?? '(non renseigné)'}`,
        ].join('\n'),
      },
      {
        title: 'Performance récente (14 derniers jours)',
        body: perfLines,
      },
      {
        title: 'Niveau d\'autonomie courant',
        body: `${ctx.autonomy_level} (${AUTONOMY_LABELS[ctx.autonomy_level]})`,
      },
      {
        title: 'Actions disponibles',
        body: [
          '- `apply_bid_change` : modifier le bid_multiplier d\'une zone (risk: low si delta < 20%, medium au-delà)',
          '- `pause_strategy` : mettre en pause toute la stratégie (risk: high)',
          '- `retrain_model` : déclencher Modal /train (risk: low)',
          '- `send_alert` : notifier un humain (risk: low)',
          '- `log_event` : juste enregistrer (risk: low)',
        ].join('\n'),
      },
    ],
    instructions: [
      ...AGENT_RULES_GENERIC,
      'Ne propose jamais une action `high` risk si autonomy_level >= 3 sans justification rigoureuse',
      'Pour `apply_bid_change`, le multiplier final doit être dans [0.1, 3.0]',
      'Tu peux proposer plusieurs actions ordonnées (ex. log_event + send_alert + apply_bid_change)',
    ],
    output_schema: `Réponds **uniquement** en JSON valide, dans un bloc \`\`\`json :

\`\`\`json
{
  "summary_french": "Résumé en 2-3 phrases en français pour le planner",
  "diagnosis": {
    "likely_causes": ["cause 1", "cause 2"],
    "confidence": "high",
    "data_evidence": "Référence aux chiffres qui supportent le diagnostic"
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
\`\`\``,
  });
}
