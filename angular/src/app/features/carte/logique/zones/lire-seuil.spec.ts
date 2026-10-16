import { lireSeuil } from './lire-seuil';

describe('lireSeuil — le texte d’un champ de seuil', () => {
  it('un champ vide (ou blanc) n’est PAS 0 : NaN, que la garde refuse', () => {
    expect(lireSeuil('')).toBeNaN();
    expect(lireSeuil('   ')).toBeNaN();
  });

  it('un nombre, entier ou décimal, négatif compris', () => {
    expect(lireSeuil('40')).toBe(40);
    expect(lireSeuil(' 12.5 ')).toBe(12.5);
    expect(lireSeuil('-3')).toBe(-3);
  });

  it('un texte qui n’est pas un nombre : NaN', () => {
    expect(lireSeuil('abc')).toBeNaN();
  });
});
