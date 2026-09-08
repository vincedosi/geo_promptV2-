/**
 * Courbes narratives du mode `by_insee_variable` — extraites de
 * Step2Geography.tsx (2026-09-08), points de courbe et libellés inchangés.
 */

import type { CurvePoint } from '../CurveEditor';

export type PresetKey = 'boost_decroches' | 'renforcer_engages' | 'cibler_milieu';

export const PRESET_CURVES: Record<PresetKey, CurvePoint[]> = {
  // Boost les zones où la variable est ÉLEVÉE (ex: forte abstention → boost)
  boost_decroches: [
    { x: 0,   y: 0.3 },
    { x: 25,  y: 0.6 },
    { x: 35,  y: 1.5 },
    { x: 50,  y: 3.0 },
    { x: 100, y: 3.5 },
  ],
  // Boost les zones où la variable est BASSE (ex: faible abstention → boost engagés)
  renforcer_engages: [
    { x: 0,   y: 3.0 },
    { x: 20,  y: 2.0 },
    { x: 35,  y: 1.0 },
    { x: 50,  y: 0.5 },
    { x: 100, y: 0.3 },
  ],
  // Cible la médiane (focus sur les zones intermédiaires, ignore les extrêmes)
  cibler_milieu: [
    { x: 0,   y: 0.3 },
    { x: 20,  y: 0.8 },
    { x: 30,  y: 2.5 },
    { x: 40,  y: 2.5 },
    { x: 50,  y: 0.8 },
    { x: 100, y: 0.3 },
  ],
};

export const PRESET_LABELS: Record<PresetKey, string> = {
  boost_decroches:    'Cibler les zones décrochées',
  renforcer_engages:  'Renforcer les engagés',
  cibler_milieu:      'Ignorer les extrêmes',
};

export const PRESET_TAGLINES: Record<PresetKey, string> = {
  boost_decroches:    'Boost progressif des CPs où la variable est élevée',
  renforcer_engages:  'Concentre le budget sur les CPs où la variable est basse',
  cibler_milieu:      'Cloche centrée sur la médiane — ignore les extrêmes',
};

