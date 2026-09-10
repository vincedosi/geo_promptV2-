import { describe, it, expect } from 'vitest';
import { bornesInternes } from '@/lib/carreaux/expressions';
import { palierEchelle } from '@/lib/carreaux/bornes';

describe('bornesInternes', () => {
  it('produit n-1 frontieres pour n classes', () => {
    expect(bornesInternes({ min: 0, max: 6 }, 6)).toHaveLength(5);
  });

  it('donne des bornes strictement croissantes — MapLibre rejette le contraire en silence', () => {
    const b = bornesInternes({ min: 0.3464, max: 3.4157 }, 6);
    for (let i = 1; i < b.length; i++) expect(b[i]).toBeGreaterThan(b[i - 1]);
  });

  it('coincide exactement avec le decoupage de la legende', () => {
    const bornes = { min: 0.3464, max: 3.4157 };
    const internes = bornesInternes(bornes, 6);
    // La frontiere k separe le palier k-1 du palier k : c'est le max de l'un
    // et le min de l'autre. C'est cette egalite qui rend la pastille honnete.
    for (let k = 1; k < 6; k++) {
      expect(internes[k - 1]).toBeCloseTo(palierEchelle(bornes, k - 1, 6).max, 10);
      expect(internes[k - 1]).toBeCloseTo(palierEchelle(bornes, k, 6).min, 10);
    }
  });
});
