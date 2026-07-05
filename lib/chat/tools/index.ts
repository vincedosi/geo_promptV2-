/**
 * lib/chat/tools/index.ts
 * Orchestrateur principal — dispatche les appels d'outils IA vers les handlers.
 */

import { analyserZone }      from './analyserZone';
import { voronoiAnalysis }   from './voronoi';
import { afficherCarreaux }  from './carreaux';
import { isochroneBattle, isochroneBattleV2 } from './isochrones';
import { askConfiguration }  from './askConfiguration';
import { analyseComplete }   from './analyseComplete';

export async function executeToolCall(
  name:            string,
  args:            Record<string, unknown>,
  validCategories: string[],
  options:         { forceRecalculate?: boolean } = {},
): Promise<unknown> {
  switch (name) {
    case 'analyser_zone_pois':
      return analyserZone(args, validCategories, options);

    case 'voronoi_analysis':
      return voronoiAnalysis(args, validCategories);

    case 'afficher_carreaux':
      return afficherCarreaux(args);

    case 'isochrone_battle':
      return isochroneBattle(args, options);

    case 'isochrone_battle_v2':
      return isochroneBattleV2(args);

    case 'ask_configuration':
      return askConfiguration(args);

    case 'analyse_complete':
      return analyseComplete(args);

    default:
      console.error('[tools] Outil inconnu:', name);
      return { error: `Outil inconnu: ${name}` };
  }
}

export { buildTools } from './schemas';
