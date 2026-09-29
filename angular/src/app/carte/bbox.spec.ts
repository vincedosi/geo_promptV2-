import { CADRE_METROPOLE, bboxDeCarte, bboxEnParametre } from './bbox';

describe('bbox', () => {
  it('lit la bbox visible d\'une carte', () => {
    const carte = { getBounds: () => ({ getWest: () => 4.75, getSouth: () => 43.35, getEast: () => 5.3, getNorth: () => 43.6 }) };
    expect(bboxDeCarte(carte as never)).toEqual([4.75, 43.35, 5.3, 43.6]);
  });
  it('écrit le paramètre de requête à 4 décimales', () => {
    expect(bboxEnParametre([4.751234, 43.35, 5.3, 43.6])).toBe('4.7512,43.3500,5.3000,43.6000');
  });
  it('le cadre métropole est celui de CLAUDE.md', () => {
    expect(CADRE_METROPOLE).toEqual([-5.5, 41.2, 9.8, 51.2]);
  });
});
