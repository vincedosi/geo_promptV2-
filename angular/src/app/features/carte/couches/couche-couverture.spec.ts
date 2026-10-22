import type maplibregl from 'maplibre-gl';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import type { LigneCouverture } from '../logique/analyses/couverture';
import { SOURCE_IRIS } from './couche-iris';
import {
  COUCHES_COUVERTURE, COUCHE_COUVERTURE_CP_FOND, COUCHE_COUVERTURE_CP_SURVOL, COUCHE_COUVERTURE_IRIS_FOND,
  COUCHE_COUVERTURE_IRIS_SURVOL, COUCHE_COUVERTURE_ZONE, type PaletteCouverture, SOURCE_COUVERTURE_CP, ZOOM_IRIS_COUVERTURE,
  classePart, entitesCouvertureCp, expressionCouleurIris, poserCoucheCouverture, retirerCoucheCouverture, surlignerCouverture,
} from './couche-couverture';

const PALETTE: PaletteCouverture = {
  s1: 'rgb(1, 1, 1)', s2: 'rgb(2, 2, 2)', s3: 'rgb(3, 3, 3)', s4: 'rgb(4, 4, 4)', s5: 'rgb(5, 5, 5)',
  absente: 'rgb(9, 9, 9)', zone: 'rgb(78, 205, 196)', trait: 'rgba(255, 255, 255, 0.16)', survol: 'rgb(240, 240, 240)',
};
const ligne = (code: string, part: number | null): LigneCouverture => ({
  code, nom: `Nom ${code}`, commune: null, n_carreaux: 1, pop_en_zone: 10, pop_totale: part === null ? null : 100, part,
});
const ZONE: GeoJSON.Feature = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[5, 43], [5.5, 43], [5.5, 43.5], [5, 43]]] }, properties: {} };
const carte = () => {
  const c = new CarteFactice();
  c.styleCharge = true;
  return c;
};
const comme = (c: CarteFactice) => c as unknown as maplibregl.Map;

describe('couche-couverture (lot 4, T8)', () => {
  it('classePart : cinq classes, une borne appartient à la classe du HAUT, null sans dénominateur', () => {
    expect([0, 19.9, 20, 59.9, 60, 80, 100].map(classePart)).toEqual([0, 0, 1, 2, 3, 4, 4]);
    expect(classePart(null)).toBeNull();
  });

  it('entitesCouvertureCp : les SEULS codes de la réponse, avec part et population', () => {
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: ['13100', '13090', '75001'].map((code) => ({ type: 'Feature', geometry: null as unknown as GeoJSON.Geometry, properties: { code } })),
    };
    const r = entitesCouvertureCp(fc, [ligne('13100', 100), ligne('13090', 42.5)]);
    expect(r.features.map((f) => f.properties)).toEqual([
      { code: '13100', nom: 'Nom 13100', part: 100, pop_en_zone: 10 },
      { code: '13090', nom: 'Nom 13090', part: 42.5, pop_en_zone: 10 },
    ]);
  });

  it('expressionCouleurIris : 5 498 codes GROUPÉS par classe (six branches au plus), sans lever', () => {
    const lignes = Array.from({ length: 5498 }, (_, i) => ligne(String(130010000 + i), i % 7 === 0 ? null : (i % 100)));
    const e = expressionCouleurIris(lignes, PALETTE) as unknown[];
    expect(e[0]).toBe('match');
    expect(e[1]).toEqual(['get', 'code_iris']);
    // match, entrée, (libellés, couleur) × 6 classes, défaut.
    expect(e).toHaveLength(2 + 6 * 2 + 1);
    const codes = e.slice(2, -1).filter((x, i) => i % 2 === 0).flat();
    expect(codes).toHaveLength(5498);
    expect(e.slice(2, -1).filter((x, i) => i % 2 === 1)).toContain(PALETTE.absente);
    expect(expressionCouleurIris([], PALETTE)).toBe('rgba(0,0,0,0)');
  });

  it('cp : contours, trait, surbrillance et contour de zone posés ; aucune couleur var( ni # dans paint', () => {
    const c = carte();
    const cp: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
    poserCoucheCouverture(comme(c), { zone: ZONE, decoupage: 'cp', cp, iris: null }, PALETTE, 'http://x/{z}/{x}/{y}');
    expect(c.ordreRendu()).toEqual([COUCHE_COUVERTURE_CP_FOND, 'couverture-cp-line', COUCHE_COUVERTURE_CP_SURVOL, COUCHE_COUVERTURE_ZONE]);
    const peinture = JSON.stringify(c.couches.map((x) => x.couche['paint']));
    expect(peinture).not.toContain('var(');
    expect(peinture).not.toContain('#');
    expect(c.sources.has(SOURCE_IRIS)).toBe(false);
  });

  it('iris : sur `iris-source` (posée si absente), minzoom 9 et filtre niveau = iris ; la source n’est jamais retirée', () => {
    const c = carte();
    poserCoucheCouverture(comme(c), { zone: null, decoupage: 'iris', cp: null, iris: [ligne('130010101', 55)] }, PALETTE, 'http://x/{z}/{x}/{y}');
    expect(c.sources.has(SOURCE_IRIS)).toBe(true);
    const fond = c.getLayer(COUCHE_COUVERTURE_IRIS_FOND)!;
    expect(fond['minzoom']).toBe(ZOOM_IRIS_COUVERTURE);
    expect(fond['source']).toBe(SOURCE_IRIS);
    expect(fond['filter']).toEqual(['all', ['==', ['get', 'niveau'], 'iris'], ['in', ['get', 'code_iris'], ['literal', ['130010101']]]]);
    retirerCoucheCouverture(comme(c));
    for (const id of COUCHES_COUVERTURE) expect(c.getLayer(id)).toBeUndefined();
    expect(c.sources.has(SOURCE_IRIS)).toBe(true);
  });

  it('forme : le contour seul ; reposer retire d’abord (aucun doublon)', () => {
    const c = carte();
    poserCoucheCouverture(comme(c), { zone: ZONE, decoupage: 'forme', cp: null, iris: null }, PALETTE, 'u');
    poserCoucheCouverture(comme(c), { zone: ZONE, decoupage: 'forme', cp: null, iris: null }, PALETTE, 'u');
    expect(c.ordreRendu()).toEqual([COUCHE_COUVERTURE_ZONE]);
  });

  it('se pose AU-DESSUS des zones enregistrées et SOUS le tracé libre (ordre des couches)', () => {
    const c = carte();
    c.addLayer({ id: 'custom-zone-fill-a', type: 'fill' });
    c.addLayer({ id: 'dessin-trace-line', type: 'line' });
    poserCoucheCouverture(comme(c), { zone: ZONE, decoupage: 'forme', cp: null, iris: null }, PALETTE, 'u');
    expect(c.ordreRendu()).toEqual(['custom-zone-fill-a', COUCHE_COUVERTURE_ZONE, 'dessin-trace-line']);
  });

  it('surlignerCouverture : filtre sur le code survolé, puis sur rien', () => {
    const c = carte();
    poserCoucheCouverture(comme(c), { zone: null, decoupage: 'iris', cp: null, iris: [ligne('130010101', 55)] }, PALETTE, 'u');
    surlignerCouverture(comme(c), '130010101');
    expect(c.getLayer(COUCHE_COUVERTURE_IRIS_SURVOL)!['filter']).toEqual(['all', ['==', ['get', 'niveau'], 'iris'], ['==', ['get', 'code_iris'], '130010101']]);
    surlignerCouverture(comme(c), null);
    expect(c.getLayer(COUCHE_COUVERTURE_IRIS_SURVOL)!['filter']).toEqual(['all', ['==', ['get', 'niveau'], 'iris'], ['==', ['get', 'code_iris'], '']]);
    expect(c.sources.has(SOURCE_COUVERTURE_CP)).toBe(false);
  });
});
