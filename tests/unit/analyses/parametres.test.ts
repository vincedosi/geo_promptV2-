import { describe, it, expect } from 'vitest';
import { cleParametres } from '@/lib/analyses/types';

describe('cle de parametres d analyse', () => {
  it('ignore l ordre des cles', () => {
    expect(cleParametres({ a: 1, b: 2 })).toBe(cleParametres({ b: 2, a: 1 }));
  });
  it('distingue deux jeux differents', () => {
    expect(cleParametres({ k: 4 })).not.toBe(cleParametres({ k: 7 }));
  });
  it('descend dans les objets imbriques', () => {
    expect(cleParametres({ o: { x: 1, y: 2 } })).toBe(cleParametres({ o: { y: 2, x: 1 } }));
  });
  it('preserve l ordre des tableaux, qui est signifiant', () => {
    expect(cleParametres({ v: [1, 2] })).not.toBe(cleParametres({ v: [2, 1] }));
  });
});

/**
 * Durcissement du 2026-09-13 (relecture de la tâche 11) : `cleParametres` sert
 * à reconnaître un rejeu à l'identique. Une COLLISION y est plus grave qu'une
 * erreur — elle ferait passer deux lancements différents pour le même.
 */
describe('cleParametres — valeurs non-JSON', () => {
  it('distingue deux dates differentes (Object.keys d une Date rend [])', () => {
    const a = cleParametres({ d: new Date('2026-01-01T00:00:00Z') });
    const b = cleParametres({ d: new Date('2026-06-01T00:00:00Z') });
    expect(a).not.toBe(b);
  });
  it('distingue une cle absente d une cle a undefined', () => {
    expect(cleParametres({ a: 1, b: undefined })).not.toBe(cleParametres({ a: 1 }));
  });
  it('distingue NaN et Infinity, que JSON.stringify ecrase tous deux en null', () => {
    expect(cleParametres({ v: NaN })).not.toBe(cleParametres({ v: Infinity }));
    expect(cleParametres({ v: NaN })).not.toBe(cleParametres({ v: null }));
  });
  it('ne leve pas sur un BigInt', () => {
    expect(() => cleParametres({ n: BigInt(42) })).not.toThrow();
  });
  it('ne leve pas sur une reference circulaire, et ne la rend jamais egale a elle-meme', () => {
    const cyclique: Record<string, unknown> = { a: 1 };
    cyclique.moi = cyclique;
    expect(() => cleParametres(cyclique)).not.toThrow();
    expect(cleParametres(cyclique)).not.toBe(cleParametres(cyclique));
  });
});
