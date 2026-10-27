import {
  anneauxBruts, erreurDeFlux, messageEchecHttp, messageEvenement, messageEvenementV2, poisDeBataille,
} from './flux';

const anneau = (id: string, palier: number, extra: Record<string, unknown> = {}): GeoJSON.Feature => ({
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [[[5, 43], [5.1, 43], [5.1, 43.1], [5, 43]]] },
  properties: { feature_type: 'ring', id, cirfa_id: id, nom: `CIRFA ${id}`, lat: 43.3, lng: 5.4, palier, ...extra },
});

describe('flux NDJSON des batailles (useMapDirectActions.ts)', () => {
  it('messages V1 / remplissage : anneaux reçus, POI trouvés, progression avec erreurs ORS, étape PostGIS', () => {
    expect(messageEvenement({ type: 'partial_rings', rings: [{}, {}] })).toBe('> ◆ +2 isochrones sur la carte');
    expect(messageEvenement({ type: 'partial_rings', rings: [] })).toBeNull();
    expect(messageEvenement({ type: 'pois_loaded', total: 2 })).toBe('> 2 POIs trouvés — démarrage ORS...');
    expect(messageEvenement({ type: 'pois_loaded' })).toBe('> ? POIs trouvés — démarrage ORS...');
    expect(messageEvenement({ type: 'progress', completed: 1, total: 2, err: 1 })).toBe('> 1/2 POIs traités — 50% (1 erreurs ORS)');
    expect(messageEvenement({ type: 'progress', completed: 0, total: 0 })).toBe('> 0/0 POIs traités — 0%');
    expect(messageEvenement({ type: 'progress', status: 'bataille_postgis' })).toBe('> [BATAILLE] ST_Difference en cours (PostGIS)...');
    expect(messageEvenement({ type: 'result' })).toBeNull();
  });

  it('messages V2 : avertissement, POI chargés, anneaux en cache, calcul', () => {
    expect(messageEvenementV2({ type: 'warning', message: '3 paliers manquants' })).toBe('> ! 3 paliers manquants');
    expect(messageEvenementV2({ type: 'pois_loaded', total: 2 })).toBe('> 2 POIs chargés');
    expect(messageEvenementV2({ type: 'rings_loaded', count: 14, missing: 0 })).toBe('> 14 anneaux en cache (0 manquants)');
    expect(messageEvenementV2({ type: 'computing', message: 'PostGIS — 14 anneaux' })).toBe('> PostGIS — 14 anneaux');
    expect(messageEvenementV2({ type: 'progress' })).toBeNull();
  });

  it('erreur de flux : une page HTML devient « Service temporairement indisponible », le reste coupé à 200', () => {
    expect(erreurDeFlux('<html>521</html>')).toBe('Service temporairement indisponible (503/521)');
    expect(erreurDeFlux('x'.repeat(250))).toHaveLength(200);
    expect(erreurDeFlux(undefined)).toBe('Erreur inconnue');
  });

  it('échec HTTP : le `error` du corps JSON (texte), sinon « HTTP <statut> », sinon erreur réseau', () => {
    expect(messageEchecHttp({ status: 400, error: '{"error":"category requis"}' })).toBe('category requis');
    expect(messageEchecHttp({ status: 500, error: 'pas du json' })).toBe('HTTP 500');
    expect(messageEchecHttp({ status: 0, error: null })).toBe('Erreur réseau');
    expect(messageEchecHttp(new Error('boom'))).toBe('boom');
  });

  it('anneaux bruts : géométrie gardée en OBJET, id = cirfa_id ?? id ; sans géométrie écartés', () => {
    const sans = { type: 'Feature', geometry: null, properties: {} } as unknown as GeoJSON.Feature;
    const bruts = anneauxBruts([anneau('a', 10), sans]);
    expect(bruts).toEqual([{ cirfa_id: 'a', nom: 'CIRFA a', lat: 43.3, lng: 5.4, palier: 10, geojson: anneau('a', 10).geometry }]);
  });

  it('POI de la bataille : `poisForMap` s’il existe, sinon un par POI des anneaux (anciens caches v3), catégorie posée', () => {
    expect(poisDeBataille([{ id: 'p', nom: 'P', lat: 1, lng: 2 }], [], 'cirfa')).toEqual([{ id: 'p', nom: 'P', lat: 1, lng: 2, categorie: 'cirfa' }]);
    const repli = poisDeBataille(undefined, [anneau('a', 10), anneau('a', 20), anneau('b', 10)], 'cirfa');
    expect(repli.map((p) => p.id)).toEqual(['a', 'b']);
    expect(repli[0]).toMatchObject({ nom: 'CIRFA a', lat: 43.3, lng: 5.4, categorie: 'cirfa' });
  });
});
