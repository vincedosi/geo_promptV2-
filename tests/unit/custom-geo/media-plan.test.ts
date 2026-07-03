import { describe, it, expect } from 'vitest';
import { normalizeShares, proportionalShares } from '@/lib/custom-geo/media-plan';

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

describe('proportionalShares', () => {
  it('répartit au prorata des volumes cibles (scénario 4 CIRFA)', () => {
    const shares = proportionalShares([
      { id: 'bretagne', volume: 118_938 },
      { id: 'paris', volume: 356_814 },
      { id: 'lyon', volume: 178_407 },
      { id: 'lille', volume: 59_469 },
    ]);
    expect(shares.paris).toBeCloseTo(50, 1);
    expect(shares.lyon).toBeCloseTo(25, 1);
    expect(shares.bretagne).toBeCloseTo(16.7, 1);
    expect(shares.lille).toBeCloseTo(8.3, 1);
    expect(sum(shares)).toBeCloseTo(100, 6);
  });

  it('parts égales quand aucun volume (stats absentes partout)', () => {
    const shares = proportionalShares([
      { id: 'a', volume: null },
      { id: 'b', volume: null },
    ]);
    expect(shares.a).toBe(50);
    expect(shares.b).toBe(50);
  });
});

describe('normalizeShares', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const start = { a: 40, b: 30, c: 20, d: 10 };

  it('réajuste les autres proportionnellement, somme toujours 100', () => {
    // a passe de 40 → 70 : il reste 30 pour b/c/d qui pesaient 60 (ratio ÷2)
    const next = normalizeShares(start, 'a', 70, ids);
    expect(next.a).toBe(70);
    expect(next.b).toBeCloseTo(15, 6);
    expect(next.c).toBeCloseTo(10, 6);
    expect(next.d).toBeCloseTo(5, 6);
    expect(sum(next)).toBeCloseTo(100, 6);
  });

  it('borne la saisie entre 0 et 100', () => {
    expect(normalizeShares(start, 'a', 250, ids).a).toBe(100);
    expect(normalizeShares(start, 'a', -10, ids).a).toBe(0);
    expect(sum(normalizeShares(start, 'a', 250, ids))).toBeCloseTo(100, 6);
  });

  it('une seule zone : verrouillée à 100 quelle que soit la saisie', () => {
    expect(normalizeShares({ solo: 100 }, 'solo', 60, ['solo'])).toEqual({ solo: 100 });
  });

  it('les autres à 0 : le reliquat se répartit à parts égales', () => {
    const next = normalizeShares({ a: 100, b: 0, c: 0 }, 'a', 40, ['a', 'b', 'c']);
    expect(next.b).toBeCloseTo(30, 6);
    expect(next.c).toBeCloseTo(30, 6);
    expect(sum(next)).toBeCloseTo(100, 6);
  });
});
