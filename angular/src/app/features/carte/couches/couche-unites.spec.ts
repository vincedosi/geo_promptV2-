import type maplibregl from 'maplibre-gl';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { COUCHE_JEU_IRIS_FOND, COUCHE_JEU_IRIS_TRAIT, poserCoucheJeu } from './couche-jeu';
import { SOURCE_IRIS } from './couche-iris';
import { classePart, expressionCouleurIris, poserUnitesGeojson } from './couche-unites';

const PALETTE = {
  s1: 'rgb(1, 1, 1)', s2: 'rgb(2, 2, 2)', s3: 'rgb(3, 3, 3)', s4: 'rgb(4, 4, 4)', s5: 'rgb(5, 5, 5)', absente: 'rgb(6, 6, 6)', trait: 'rgb(8, 8, 8)', zone: 'rgb(7, 7, 7)',
};
const carte = () => new CarteFactice() as unknown as maplibregl.Map & CarteFactice;

describe('couche-unites — la peinture par part partagée par ④ et ⑤ (lot 5, T11)', () => {
  it('classes de part : une borne appartient à la classe du haut ; sans dénominateur, aucune classe', () => {
    expect([0, 19.9, 20, 59, 80, 100].map(classePart)).toEqual([0, 0, 1, 2, 4, 4]);
    expect(classePart(null)).toBeNull();
  });
  it('5 498 IRIS : un `match` groupé (six branches au plus), posé sans lever', () => {
    const lignes = Array.from({ length: 5498 }, (_, i) => ({ code: String(130010000 + i), part: i % 101 }));
    const expr = expressionCouleurIris(lignes, PALETTE) as unknown[];
    expect(expr[0]).toBe('match');
    expect((expr.length - 3) / 2).toBeLessThanOrEqual(6);
    const c = carte();
    expect(() => poserCoucheJeu(c, { zone: null, unites: null, iris: { retenus: lignes, touches: lignes.map((l) => l.code) } }, PALETTE, 'http://h/{z}/{x}/{y}')).not.toThrow();
    expect(c.sources.has(SOURCE_IRIS)).toBe(true);
    expect(c.getLayer(COUCHE_JEU_IRIS_FOND)!['minzoom']).toBe(9);
    expect(JSON.stringify(c.getLayer(COUCHE_JEU_IRIS_TRAIT)!['filter'])).toContain('"niveau"');
  });
  it('options : un aplat filtré et un trait fin n’altèrent pas les défauts de ④ (trait 0,8 px, couleur `trait`)', () => {
    const c = carte();
    const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
    poserUnitesGeojson(c, { source: 's', fond: 'f', trait: 't' }, fc, PALETTE);
    expect(c.getLayer('t')!['paint']).toEqual({ 'line-color': 'rgb(8, 8, 8)', 'line-width': 0.8 });
    expect(c.getLayer('f')!['filter']).toBeUndefined();
  });
});
