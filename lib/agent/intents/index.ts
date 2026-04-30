/**
 * Registry pluggable des intents agent.
 *
 * Chaque intent s'auto-enregistre via `registerIntent()` à l'import.
 * Pour ajouter un nouvel intent : créer le fichier dans `intents/`, l'importer
 * dans `_loadAll()` ci-dessous. Aucune modif d'orchestrator nécessaire.
 */
import type { AgentIntent } from '../types';

export const INTENT_REGISTRY: Record<string, AgentIntent> = {};

let loaded = false;

export function registerIntent(intent: AgentIntent) {
  if (INTENT_REGISTRY[intent.code]) return; // idempotent (HMR)
  INTENT_REGISTRY[intent.code] = intent;
}

export function getIntent(code: string): AgentIntent | null {
  return INTENT_REGISTRY[code] ?? null;
}

export function listIntents(): AgentIntent[] {
  return Object.values(INTENT_REGISTRY);
}

/**
 * Charge tous les intents (auto-register via side-effect).
 * Appelé par l'orchestrator avant la 1re utilisation.
 */
export async function loadAllIntents() {
  if (loaded) return;
  loaded = true;
  await Promise.all([
    import('./analyze_drift'),
    import('./explain_decision'),
    import('./query_data'),
    import('./recommend_action'),
    import('./create_strategy'),
    import('./compare_campaigns'),
    import('./navigate'),
    import('./generate_report'),
    import('./detect_anomaly'),
  ]);
}
