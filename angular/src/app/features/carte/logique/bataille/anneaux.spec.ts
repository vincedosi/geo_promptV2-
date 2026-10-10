import { BATTLE_PALIER_OPACITY, VORONOI_PALETTE } from '../palettes-donnees-carte';
import { pointsBataille, stylerAnneaux } from './anneaux';

const anneau = (id: string, palier?: number, cle: 'id' | 'cirfa_id' = 'id'): GeoJSON.Feature => ({
  type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { [cle]: id, nom: `POI ${id}`, ...(palier === undefined ? {} : { palier }) },
});

describe('anneaux de bataille (applyIsochroneBattle, useMapLayers.ts:1029-1136)', () => {
  it('une teinte par POI dans l’ordre d’apparition, opacité par palier (120 par défaut, 0,20 si inconnu), légende', () => {
    const { anneaux, legende } = stylerAnneaux([anneau('a', 10), anneau('b', 20), anneau('a', 30), anneau('c', undefined, 'cirfa_id'), anneau('a', 7)]);
    expect(anneaux.map((f) => f.properties!['battle_color'])).toEqual([VORONOI_PALETTE[0], VORONOI_PALETTE[1], VORONOI_PALETTE[0], VORONOI_PALETTE[2], VORONOI_PALETTE[0]]);
    expect(anneaux.map((f) => f.properties!['battle_opacity'])).toEqual([0.65, 0.58, 0.5, BATTLE_PALIER_OPACITY[120], 0.2]);
    // La légende ne lit que `id` (comme React) : l'anneau v1 sans `id` n'y figure pas.
    expect(legende).toEqual([
      { id: 'a', nom: 'POI a', color: VORONOI_PALETTE[0] },
      { id: 'b', nom: 'POI b', color: VORONOI_PALETTE[1] },
    ]);
  });

  it('points : coordonnées finies et non nulles seulement', () => {
    const p = pointsBataille([
      { id: 'a', nom: 'A', lat: 43, lng: 5, ville: 'Marseille' },
      { id: 'b', nom: 'B', lat: 0, lng: 5 },
      { id: 'c', nom: 'C', lat: Number.NaN, lng: 5 },
    ]);
    expect(p).toEqual([{ type: 'Feature', geometry: { type: 'Point', coordinates: [5, 43] }, properties: { nom: 'A', adresse: '', ville: 'Marseille', id: 'a' } }]);
  });
});
