/**
 * lib/chat/tools/index.ts
 * Orchestrateur principal — dispatche les appels d'outils IA vers les handlers.
 */

import { analyserZone }      from './analyserZone';
import { voronoiAnalysis }   from './voronoi';
import { afficherCarreaux }  from './carreaux';
import { isochroneBattle, isochroneBattleV2 } from './isochrones';
import { analyserPanneaux }  from './panneaux';
import { audienceCoverage }  from './audienceCoverage';
import { classerAudience }   from './classerAudience';
import { scorerOoh }         from './scorerOoh';
import { exporterRapport }   from './exporterRapport';
import { synergy }           from './synergy';
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

    case 'analyser_panneaux':
      return analyserPanneaux(args);

    case 'calculate_audience_coverage':
      return audienceCoverage(args);

    case 'classer_panneaux_audience':
      return classerAudience(args);

    case 'scorer_panneaux_ooh':
      return scorerOoh(args);

    case 'exporter_rapport_ooh':
      return exporterRapport(args);

    case 'analyze_poi_synergy':
      return synergy(args);

    case 'ask_configuration':
      return askConfiguration(args);

    case 'analyse_complete':
      return analyseComplete(args);

    case 'analyse_correlation': {
      const poi = (args.poi_category as string) ?? '';
      const metric = (args.iris_metric as string) ?? 'population';
      const dep = (args.departement as string) ?? null;
      const autoIa = args.auto_analyse_ia !== false;
      if (!poi) return { error: 'poi_category est requis.' };
      return {
        action:       'analyse_correlation',
        poiCategory:  poi,
        irisMetric:   metric,
        departement:  dep,
        autoAnalyse:  autoIa,
      };
    }

    default:
      console.error('[tools] Outil inconnu:', name);
      return { error: `Outil inconnu: ${name}` };
  }
}

export { buildTools } from './schemas';
