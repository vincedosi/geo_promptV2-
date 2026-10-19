import { voisin } from './voisin';

describe('voisin — onglet suivant ou précédent, en boucle (motif ARIA « tabs », vague finale H5)', () => {
  it('→ avance d’un cran, et revient au premier après le dernier', () => {
    expect(voisin(0, 3, 'ArrowRight')).toBe(1);
    expect(voisin(2, 3, 'ArrowRight')).toBe(0);
  });

  it('← recule d’un cran, et passe au dernier avant le premier', () => {
    expect(voisin(2, 3, 'ArrowLeft')).toBe(1);
    expect(voisin(0, 3, 'ArrowLeft')).toBe(2);
  });

  it('un seul onglet : reste sur lui', () => {
    expect(voisin(0, 1, 'ArrowRight')).toBe(0);
    expect(voisin(0, 1, 'ArrowLeft')).toBe(0);
  });
});
