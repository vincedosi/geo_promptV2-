import { TRANSFORMATIONS, aplatir, compterSommets, enrichissementBataille, sourceTypeCapture, texteBbox } from './capture';

const carre: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 1], [0, 0]]] };
const point: GeoJSON.Point = { type: 'Point', coordinates: [5, 7] };

describe('capture — logique pure de la capture des couches (CustomGeoCaptureModal.tsx)', () => {
  it('les quatre transformations, union par défaut en tête, textes de React', () => {
    expect(TRANSFORMATIONS.map((t) => t.valeur)).toEqual(['union', 'convex_hull', 'envelope', 'raw']);
    expect(TRANSFORMATIONS[0]).toEqual({ valeur: 'union', libelle: 'Union des layers', aide: 'Forme naturelle dissoute (recommande)' });
  });

  it('aplatir : null → rien, une géométrie → [g], un tableau tel quel', () => {
    expect(aplatir(null)).toEqual([]);
    expect(aplatir(point)).toEqual([point]);
    expect(aplatir([point, carre])).toEqual([point, carre]);
  });

  it('sommets et emprise de toutes les géométries', () => {
    expect(compterSommets([carre, point])).toBe(5);
    expect(texteBbox([carre, point])).toBe('0.000, 0.000 → 5.000, 7.000');
    expect(texteBbox([])).toBe('—');
  });

  it('source_type : celui de l’unique couche, sinon « composite »', () => {
    expect(sourceTypeCapture(['carreaux_filosofi'])).toBe('carreaux_filosofi');
    expect(sourceTypeCapture(['carreaux_filosofi', 'iris_selection'])).toBe('composite');
  });

  it('bataille à plusieurs POI : POI hissés dans source_metadata et une sous-zone par POI (son plus grand palier)', () => {
    const anneau = (id: string, palier: number): GeoJSON.Feature => ({
      type: 'Feature', properties: { poi_id: id, palier }, geometry: { ...carre, coordinates: [[[palier, 0], [1, 1], [0, 1], [palier, 0]]] },
    });
    const meta = {
      cache_key: 'k', category: 'cirfa', mode: 'driving',
      pois: [{ poi_id: 'a', poi_name: 'A', lat: 1, lng: 2 }, { poi_id: 'b', poi_name: 'B', lat: 3, lng: 4 }],
      battle_features: [anneau('a', 10), anneau('a', 20), anneau('b', 15)],
    };
    const r = enrichissementBataille(meta)!;
    expect(r.enrichissement).toEqual({ cache_key: 'k', category: 'cirfa', mode: 'driving', paliers: [10, 15, 20], poi_count: 2, pois: meta.pois });
    expect(r.sousZones!.map((s) => [s.name, s.source_ref, (s.geometry as GeoJSON.Polygon).coordinates[0][0][0]]))
      .toEqual([['A', 'a', 20], ['B', 'b', 15]]);
    expect(r.sousZones![0].default_multiplier).toBe(1);
  });

  it('③ finitions (T4) : les anneaux de la V2 portent le POI sous `cirfa_id` (pas `poi_id`) — une sous-zone par POI quand même', () => {
    const anneau = (id: string, palier: number): GeoJSON.Feature => ({
      type: 'Feature', properties: { feature_type: 'ring', id, cirfa_id: id, palier }, geometry: { ...carre, coordinates: [[[palier, 0], [1, 1], [0, 1], [palier, 0]]] },
    });
    const r = enrichissementBataille({
      cache_key: 'battle_v2_full__cirfa__drive__10-20min__metro__pabc', category: 'cirfa', mode: 'drive',
      pois: [{ poi_id: 'a', poi_name: 'A', lat: 1, lng: 2 }, { poi_id: 'b', poi_name: 'B', lat: 3, lng: 4 }],
      battle_features: [anneau('a', 10), anneau('a', 20), anneau('b', 10)],
    })!;
    expect(r.enrichissement['paliers']).toEqual([10, 20]);
    expect(r.sousZones!.map((s) => [s.source_ref, (s.geometry as GeoJSON.Polygon).coordinates[0][0][0]])).toEqual([['a', 20], ['b', 10]]);
  });

  it('bataille sans POI : rien à enrichir ; un seul POI : pas de sous-zones', () => {
    expect(enrichissementBataille({ pois: [] })).toBeNull();
    const un = enrichissementBataille({ pois: [{ poi_id: 'a', poi_name: 'A', lat: 1, lng: 2 }], battle_features: [] })!;
    expect(un.sousZones).toBeNull();
    expect(un.enrichissement['poi_count']).toBe(1);
  });
});
