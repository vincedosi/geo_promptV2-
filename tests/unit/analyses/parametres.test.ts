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
