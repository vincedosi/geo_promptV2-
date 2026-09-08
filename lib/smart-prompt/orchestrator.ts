/**
 * lib/smart-prompt/orchestrator.ts
 * Orchestre le routage Mistral → exécution de l'agent → réponse unifiée.
 */

import { createAdminClient }    from '@/lib/auth';
import { logger } from '@/lib/logger';
import { routePrompt }          from './router-prompt';
import { runDemographieAgent }  from './agents/demographie';
import type {
  AgentName,
  AgentResult,
  RegistryEntry,
  SmartPromptResponse,
} from './types';

// Charge le registre actif depuis Supabase
async function loadRegistry(): Promise<RegistryEntry[]> {
  const sb = createAdminClient();
  const { data, error } = await sb.rpc('get_active_data_registry');
  if (error || !data) {
    console.warn('[smart-prompt] Impossible de charger data_registry:', error?.message);
    return [];
  }
  return data as RegistryEntry[];
}

// Exécute l'agent sélectionné par le routeur
async function executeAgent(
  agent:  AgentName,
  params: Record<string, unknown>,
): Promise<AgentResult> {
  switch (agent) {
    case 'demographie':
      return runDemographieAgent(params);

    case 'panneaux':
      // Agent panneaux : redirige vers l'outil existant via message d'orientation
      return {
        agent:   'panneaux',
        success: true,
        markdown: [
          '## Panneaux OOH',
          'Pour analyser les panneaux, utilisez le chat principal avec des requêtes comme :',
          '- *"Montre-moi les panneaux JCDecaux à Lyon"*',
          '- *"Classe les meilleurs panneaux pour les 18-24 ans à Paris"*',
          '- *"Score OOH multi-critères à Bordeaux pour les cadres"*',
        ].join('\n'),
        explication: 'Agent panneaux — orientation vers le chat principal.',
      };

    case 'isochrone_battle':
      return {
        agent:   'isochrone_battle',
        success: true,
        markdown: [
          '## Sectorisation isochrones',
          'Pour lancer une bataille d\'isochrones, utilisez le chat principal :',
          '- *"Lance une bataille d\'isochrones pour les CIRFA en France"*',
          '- *"Sectorisation drive 10/20/30 min pour les pharmacies"*',
          '',
          'Ou accédez directement à **Map > Analyses > Bataille ORS**.',
        ].join('\n'),
        explication: 'Agent isochrone_battle — orientation vers le chat principal.',
      };

    case 'benchmark':
      return {
        agent:   'benchmark',
        success: true,
        markdown: [
          '## Benchmark multi-villes',
          'Précisez les villes et l\'indicateur à comparer. Exemple :',
          '- *"Compare le revenu médian entre Paris, Lyon et Bordeaux"*',
          '- *"Classement des villes par densité de jeunes 18-24 ans"*',
        ].join('\n'),
        explication: 'Agent benchmark — demande de précision.',
      };

    case 'unknown':
    default:
      return {
        agent:   'unknown',
        success: false,
        markdown: [
          '## Requête non reconnue',
          'Je n\'ai pas pu identifier le type d\'analyse demandé.',
          '',
          'Essayez des formulations comme :',
          '- *"Quel est le revenu médian à Bordeaux ?"*',
          '- *"Combien de CIRFA en France ?"*',
        ].join('\n'),
        error: 'Requête hors périmètre ou ambiguë.',
      };
  }
}

// Log le feedback dans Supabase (silencieux si erreur)
async function logFeedback(
  message:    string,
  agent:      AgentName,
  confidence: number,
  success:    boolean,
  error_msg?: string,
  params?:    Record<string, unknown>,
): Promise<void> {
  try {
    const sb = createAdminClient();
    await sb.rpc('log_smart_prompt_feedback', {
      p_message:    message,
      p_agent:      agent,
      p_confidence: confidence,
      p_success:    success,
      p_error_msg:  error_msg ?? undefined,
      p_params:     params ?? undefined,
    });
  } catch {
    // Non-bloquant
  }
}

// Point d'entrée principal
export async function orchestrate(
  userMessage: string,
): Promise<SmartPromptResponse> {
  const registry = await loadRegistry();

  logger.debug('smart-prompt', `orchestrate → ${JSON.stringify(userMessage).slice(0, 80)}`);
  const t0 = Date.now();

  const decision = await routePrompt(userMessage, registry);
  logger.debug('smart-prompt', `routing → ${decision.agent} confidence: ${decision.confidence} params: ${JSON.stringify(decision.params)}`);
  logger.debug('smart-prompt', `routePrompt took ${Date.now() - t0} ms`);

  const t1 = Date.now();
  const result = await executeAgent(decision.agent, decision.params);
  logger.debug('smart-prompt', `executeAgent took ${Date.now() - t1} ms — success: ${result.success} ${result.error ?? ''}`);

  // Log feedback (non-bloquant)
  logFeedback(
    userMessage,
    decision.agent,
    decision.confidence,
    result.success,
    result.error,
    decision.params,
  );

  return {
    decision,
    result,
    registry_used: registry.length,
  };
}
