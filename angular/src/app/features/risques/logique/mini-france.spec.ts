import {
  type ZoneGeo, cadreDe, centreDe, chemin, elargir, mercatorX, mercatorY, projecteur, separerLointains,
} from './mini-france';

/*
 * Valeurs attendues produites UNE fois par la version REACT (gel P5 : ses fonctions ne sont pas exportées) :
 *   1. extraction des lignes 67-78 et 137-299 de `components/risques/CarteMiniFrance.tsx` dans un module jetable,
 *      hors dépôt, terminé par `export { mercatorX, mercatorY, projecteur, cadreDe, elargir, chemin, centreDe,
 *      separerLointains }` ;
 *   2. `node_modules/.bin/tsx produire.ts` sur les cinq zones ci-dessous (2026-10-04), sorties recopiées telles quelles.
 */
const ZONES = [
  { type: 'Feature', properties: { code: '75', nom: 'Paris' }, geometry: { type: 'Polygon', coordinates: [[[2.22, 48.82], [2.47, 48.82], [2.47, 48.9], [2.22, 48.9], [2.22, 48.82]]] } },
  { type: 'Feature', properties: { code: '13', nom: 'Bouches-du-Rhône' }, geometry: { type: 'MultiPolygon', coordinates: [
    [[[4.23, 43.16], [5.81, 43.16], [5.81, 43.92], [4.23, 43.92], [4.23, 43.16]]],
    [[[5.3, 43.0], [5.42, 43.0], [5.36, 43.06], [5.3, 43.0]]],
  ] } },
  // Une collection, un trou, et un anneau dégénéré (2 points) qui doit être ignoré.
  { type: 'Feature', properties: { code: '59', nom: 'Nord' }, geometry: { type: 'GeometryCollection', geometries: [
    { type: 'Polygon', coordinates: [[[2.07, 50.02], [4.23, 50.02], [4.23, 51.09], [2.07, 51.09], [2.07, 50.02]], [[3.0, 50.6], [3.1, 50.6], [3.1, 50.7], [3.0, 50.6]], [[1, 1], [2, 2]]] },
  ] } },
  { type: 'Feature', properties: { code: '972', nom: 'Martinique' }, geometry: { type: 'Polygon', coordinates: [[[-61.23, 14.39], [-60.81, 14.39], [-60.81, 14.88], [-61.23, 14.88], [-61.23, 14.39]]] } },
  { type: 'Feature', properties: { code: '974', nom: 'La Réunion' }, geometry: { type: 'Polygon', coordinates: [[[55.21, -21.39], [55.84, -21.39], [55.84, -20.87], [55.21, -20.87], [55.21, -21.39]]] } },
] as ZoneGeo[];

const BOITE_METRO = { x: 0, y: 0, w: 300, h: 258 };

describe('mini-france (parité React figée)', () => {
  it('Mercator en radians sur les deux axes', () => {
    expect(mercatorX(2.35)).toBeCloseTo(0.041015237421866746, 15);
    expect(mercatorY(48.85)).toBeCloseTo(0.9798233798978104, 15);
  });

  it('cadreDe : collections comprises, outre-mer compris ; null sans géométrie', () => {
    expect(cadreDe(ZONES)).toEqual({ ouest: -61.23, est: 55.84, sud: -21.39, nord: 51.09 });
    expect(cadreDe([])).toBeNull();
  });

  it('separerLointains : la Martinique et La Réunion sortent du cadre principal', () => {
    const s = separerLointains(ZONES);
    expect(s.principal.map((z) => z.properties.code)).toEqual(['75', '13', '59']);
    expect(s.lointains.map((z) => z.properties.code)).toEqual(['972', '974']);
    expect(cadreDe(s.principal)).toEqual({ ouest: 2.07, est: 5.81, sud: 43, nord: 51.09 });
  });

  it('elargir : marge relative, plancher de 0,05°', () => {
    expect(elargir(cadreDe([ZONES[1]])!, 0.18)).toEqual({
      ouest: 3.9456000000000007, est: 6.094399999999999, sud: 42.8344, nord: 44.0856,
    });
    expect(elargir({ ouest: 2, est: 2.01, sud: 48, nord: 48.01 }, 0.18)).toEqual({
      ouest: 1.95, est: 2.0599999999999996, sud: 47.95, nord: 48.059999999999995,
    });
  });

  it('chemin et centreDe sur la métropole', () => {
    const proj = projecteur(cadreDe(separerLointains(ZONES).principal)!, BOITE_METRO);
    expect(chemin(ZONES[0], proj)).toBe('M112.7,76.5L118.1,76.5L118.1,73.8L112.7,73.8L112.7,76.5Z');
    expect(chemin(ZONES[1], proj)).toBe(
      'M156.3,253.3L190.5,253.3L190.5,230.5L156.3,230.5L156.3,253.3ZM179.5,258.0L182.1,258.0L180.8,256.2L179.5,258.0Z',
    );
    expect(chemin(ZONES[2], proj)).toBe(
      'M109.5,36.5L156.3,36.5L156.3,0.0L109.5,0.0L109.5,36.5ZM129.6,16.8L131.8,16.8L131.8,13.4L129.6,16.8Z',
    );
    expect(centreDe(ZONES[0], proj)).toEqual([115.43381905796197, 75.16359065132093]);
    expect(centreDe(ZONES[1], proj)).toEqual([173.4053137413173, 244.31777952588507]);
    expect(centreDe(ZONES[2], proj)).toEqual([132.87944642996237, 18.353665160936345]);
  });

  it('chemin des cartouches d’outre-mer (boîtes de 30, pas de 35)', () => {
    const om = separerLointains(ZONES).lointains;
    const traces = om.map((z, i) => chemin(z, projecteur(cadreDe([z])!, { x: 3 + i * 35, y: 260, w: 30, h: 30 })));
    expect(traces).toEqual([
      'M5.6,290.0L30.4,290.0L30.4,260.0L5.6,260.0L5.6,290.0Z',
      'M38.0,288.3L68.0,288.3L68.0,261.7L38.0,261.7L38.0,288.3Z',
    ]);
  });

  it('cadrage sur une unité : elle remplit la boîte, centrée', () => {
    const proj = projecteur(elargir(cadreDe([ZONES[1]])!, 0.18), BOITE_METRO);
    expect(chemin(ZONES[1], proj)).toBe(
      'M39.7,187.2L260.3,187.2L260.3,40.8L39.7,40.8L39.7,187.2ZM189.1,217.8L205.8,217.8L197.5,206.3L189.1,217.8Z',
    );
    expect(centreDe(ZONES[1], proj)).toEqual([149.9999999999999, 129.62259261057523]);
  });
});
