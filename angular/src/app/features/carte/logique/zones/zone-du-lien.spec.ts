import { creneauDepuisZone, zoneDeCle } from './zone-du-lien';

describe('zone-du-lien (page.tsx:790-823)', () => {
  it('MultiPolygon éclaté en anneaux (`_idx`), palier 1, POI au centre de l’emprise, clé cg__', () => {
    const c = creneauDepuisZone({
      type: 'Feature',
      geometry: { type: 'MultiPolygon', coordinates: [[[[0, 40], [2, 40], [2, 42], [0, 40]]], [[[4, 44], [6, 44], [6, 46], [4, 44]]]] },
      properties: { id: 'z1', name: 'Deux îles' },
    })!;
    expect(c.anneaux.map((a) => a.properties)).toEqual([
      { id: 'z1', cirfa_id: 'z1', nom: 'Deux îles', palier: 1, _idx: 0 },
      { id: 'z1', cirfa_id: 'z1', nom: 'Deux îles', palier: 1, _idx: 1 },
    ]);
    expect(c.anneaux[1].geometry).toEqual({ type: 'Polygon', coordinates: [[[4, 44], [6, 44], [6, 46], [4, 44]]] });
    expect(c.bbox).toEqual([0, 40, 6, 46]);
    expect(c.poi).toEqual({ id: 'z1', nom: 'Deux îles', lat: 43, lng: 3 });
    expect(c.cle).toBe('cg__z1');
  });

  it('sans nom : « Zone personnalisée » ; géométrie non polygonale gardée entière, sans emprise, centre par défaut', () => {
    const c = creneauDepuisZone({ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { id: 'p', name: null } })!;
    expect(c.anneaux).toEqual([{ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { id: 'p', cirfa_id: 'p', nom: 'Zone personnalisée', palier: 1 } }]);
    expect(c.bbox).toBeNull();
    expect(c.poi).toEqual({ id: 'p', nom: 'Zone personnalisée', lat: 46.5, lng: 2.5 });
  });

  it('sans géométrie : null (rien n’est affiché, comme React)', () => {
    expect(creneauDepuisZone({ type: 'Feature', geometry: null, properties: { id: 'x' } })).toBeNull();
    expect(creneauDepuisZone(null)).toBeNull();
  });

  it('zoneDeCle : seulement une clé cg__', () => {
    expect(zoneDeCle('cg__abc')).toBe('abc');
    expect(zoneDeCle('lycee__walk__10')).toBeNull();
    expect(zoneDeCle(null)).toBeNull();
  });
});
