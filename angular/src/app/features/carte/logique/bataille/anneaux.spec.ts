import { BATTLE_PALIER_OPACITY, VORONOI_PALETTE } from '../palettes-donnees-carte';
import { empriseAnneaux, filtreAnneaux, pointsBataille, poisDesAnneaux, stylerAnneaux, stylerPartiels } from './anneaux';

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

  it('anneaux partiels (addBattlePartialRings) : cumulés, une teinte par POI qui CONTINUE la palette, 0,15 si palier inconnu', () => {
    const geo = { type: 'Polygon', coordinates: [] } as GeoJSON.Polygon;
    const brut = (id: string, palier: number) => ({ cirfa_id: id, nom: `POI ${id}`, lat: 43, lng: 5, palier, geojson: geo });
    const un = stylerPartiels([], [brut('a', 10), brut('b', 7)]);
    expect(un.map((f) => [f.properties!['battle_color'], f.properties!['battle_opacity'], f.properties!['_partial']]))
      .toEqual([[VORONOI_PALETTE[0], 0.65, true], [VORONOI_PALETTE[1], 0.15, true]]);
    const deux = stylerPartiels(un, [brut('c', 10), brut('a', 20)]);
    expect(deux).toHaveLength(4);
    expect(deux.slice(2).map((f) => f.properties!['battle_color'])).toEqual([VORONOI_PALETTE[2], VORONOI_PALETTE[0]]);
  });

  it('filtre des anneaux : jamais les bordures ; palier 0 seulement « Voronoï » coché ; paliers au-delà du maximum cachés', () => {
    expect(filtreAnneaux(false, 30)).toEqual(['all', ['!=', ['get', 'feature_type'], 'border'], ['!=', ['get', 'palier'], 0], ['<=', ['get', 'palier'], 30]]);
    expect(filtreAnneaux(true, 90)).toEqual(['all', ['!=', ['get', 'feature_type'], 'border'],
      ['any', ['==', ['get', 'palier'], 0], ['<=', ['get', 'palier'], 90]]]);
  });

  it('POI repris des anneaux (repli sans poisForMap) : un par id, coordonnées valides', () => {
    const f = (id: string, lat: number): GeoJSON.Feature => ({ type: 'Feature', geometry: null as unknown as GeoJSON.Geometry, properties: { cirfa_id: id, nom: id, lat, lng: 5, adresse: 'rue', ville: 'V' } });
    expect(poisDesAnneaux([f('a', 43), f('a', 43), f('b', 0)])).toEqual([{ id: 'a', nom: 'a', lat: 43, lng: 5, adresse: 'rue', ville: 'V' }]);
  });

  it('emprise des anneaux : polygones et multipolygones seulement, `null` sans coordonnée', () => {
    const p: GeoJSON.Feature = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[5, 43], [6, 44], [5, 43]]] }, properties: {} };
    const m: GeoJSON.Feature = { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[[[4, 42], [4.5, 42.5], [4, 42]]]] }, properties: {} };
    const pt: GeoJSON.Feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} };
    expect(empriseAnneaux([p, m, pt])).toEqual([[4, 42], [6, 44]]);
    expect(empriseAnneaux([pt])).toBeNull();
  });
});
