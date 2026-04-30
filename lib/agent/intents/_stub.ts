/**
 * Helper pour générer des stubs d'intents (P2-P9 à implémenter dans des sous-chantiers).
 * V1 d'A4.5 : seul `analyze_drift` est totalement implémenté.
 */
import { registerIntent } from './index';
import type { AgentIntent, IntentInput, IntentOutput } from '../types';

export function makeStubIntent(opts: {
  code: string;
  display_name_fr: string;
  description: string;
}): AgentIntent {
  const intent: AgentIntent = {
    code: opts.code,
    display_name_fr: opts.display_name_fr,
    description: opts.description,
    handler: async (_input: IntentInput): Promise<IntentOutput> => ({
      response_text: `L'intent "${opts.display_name_fr}" est prévu dans une prochaine itération de GeoAgent. Pour l'instant, je peux uniquement analyser les drift events détectés.`,
      proposed_actions: [],
      action_status: 'none',
    }),
  };
  registerIntent(intent);
  return intent;
}
