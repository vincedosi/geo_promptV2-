import { TRANSFORMATIONS, aplatir, compterSommets, enrichissementBataille, sourceTypeCapture, texteBbox } from './capture';

const carre: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 1], [0, 0]]] };
const point: GeoJSON.Point = { type: 'Point', coordinates: [5, 7] };

describe('capture — logique pure de la capture des couches (CustomGeoCaptureModal.tsx)', () => {
  it('les quatre transformations, union par défaut en tête, textes de React', () => {
    expect(TRANSFORMATIONS.map((t) => t.valeur)).toEqual(['union', 'convex_hull', 'envelope', 'raw']);
    expect(TRANSFORMATIONS[0]).toEqual({ valeur: 'union', libelle: 'Union des layers', aide: 'Forme naturelle dissoute (recommandé)' });
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

  it('bataille à plusieurs POI : POI hissés dans source_metadata et une sous-zone par POI (tous ses paliers)', () => {
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
    expect(r.sousZones!.map((s) => [s.name, s.source_ref, s.geometries.map((g) => (g as GeoJSON.Polygon).coordinates[0][0][0])]))
      .toEqual([['A', 'a', [10, 20]], ['B', 'b', [15]]]);
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
    expect(r.sousZones!.map((s) => [s.source_ref, s.geometries.length])).toEqual([['a', 2], ['b', 1]]);
  });

  it('③ finitions (preuve T7, D-1) : les anneaux V2 sont des BANDES disjointes — la sous-zone d’un POI porte TOUTES ses bandes, à unir', () => {
    // Trois bandes DISJOINTES de « a » (0-1, 1-2, 2-3 en x) : le plus grand palier seul n'en couvre qu'un tiers.
    const bande = (id: string, palier: number, x: number): GeoJSON.Feature => ({
      type: 'Feature', properties: { feature_type: 'ring', cirfa_id: id, palier },
      geometry: { type: 'Polygon', coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] },
    });
    const r = enrichissementBataille({
      pois: [{ poi_id: 'a', poi_name: 'A', lat: 1, lng: 2 }, { poi_id: 'b', poi_name: 'B', lat: 3, lng: 4 }],
      battle_features: [bande('a', 10, 0), bande('a', 20, 1), bande('a', 30, 2), bande('b', 10, 5)],
    })!;
    const a = r.sousZones![0];
    expect(a.source_ref).toBe('a');
    expect(a.geometries.map((g: GeoJSON.Geometry) => (g as GeoJSON.Polygon).coordinates[0][0][0])).toEqual([0, 1, 2]);
    expect(r.sousZones![1].geometries).toHaveLength(1);
    expect('geometry' in a).toBe(false);
  });

  it('bataille sans POI : rien à enrichir ; un seul POI : pas de sous-zones', () => {
    expect(enrichissementBataille({ pois: [] })).toBeNull();
    const un = enrichissementBataille({ pois: [{ poi_id: 'a', poi_name: 'A', lat: 1, lng: 2 }], battle_features: [] })!;
    expect(un.sousZones).toBeNull();
    expect(un.enrichissement['poi_count']).toBe(1);
  });
});
