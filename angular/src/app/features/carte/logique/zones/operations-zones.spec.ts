import {
  MESSAGE_TROP_DE_ZONES, basculerDansSelection, libelleSelection, messageZoneCreee, nomZoneCreee, operationPossible, selectionExistante,
} from './operations-zones';

const NOMS = new Map([['a', 'Bretagne'], ['b', 'Finistère']]);

describe('operations-zones (ZonesOperations.tsx)', () => {
  it('possible : union, différence et intersection à deux zones ou plus (C20 : l’intersection n’est plus bornée à deux)', () => {
    expect([1, 2, 3].map((n) => operationPossible('union', n))).toEqual([false, true, true]);
    expect([1, 2, 3].map((n) => operationPossible('difference', n))).toEqual([false, true, true]);
    expect([1, 2, 3].map((n) => operationPossible('intersection', n))).toEqual([false, true, true]);
  });

  it('C20 round 1 : 20 zones au plus pour les trois opérations, la raison est dite', () => {
    for (const op of ['union', 'intersection', 'difference'] as const) {
      expect([20, 21].map((n) => operationPossible(op, n)), op).toEqual([true, false]);
    }
    expect(MESSAGE_TROP_DE_ZONES).toBe('Cochez 20 zones au plus.');
  });

  it('noms de la zone créée, au singulier et au pluriel, id tronqué pour un nom inconnu', () => {
    expect(nomZoneCreee('difference', ['a', 'b'], NOMS)).toBe('Bretagne — moins 1 zone');
    expect(nomZoneCreee('intersection', ['a', 'b', 'c'], NOMS)).toBe('Bretagne — restreinte à 2 zones');
    expect(nomZoneCreee('union', ['b', 'a'], NOMS)).toBe('Fusion de 2 zones — Finistère…');
    expect(nomZoneCreee('union', ['0123456789abcdef', 'a'], NOMS)).toBe('Fusion de 2 zones — 01234567…');
  });

  it('message de réussite et libellé de sélection', () => {
    expect(messageZoneCreee(1, null)).toBe('Zone créée : 1 code postal');
    expect(messageZoneCreee(1234, 56.7)).toBe(`Zone créée : ${(1234).toLocaleString('fr-FR')} codes postaux · 56,7 km²`);
    expect(messageZoneCreee(undefined, 0)).toBe('Zone créée : 0 code postal');
    expect(libelleSelection(1)).toBe('1 zone sélectionnée');
    expect(libelleSelection(3)).toBe('3 zones sélectionnées');
  });

  it('sélection : ordre de cochage gardé ; zones disparues retirées, même référence si rien ne change', () => {
    expect(basculerDansSelection(['a'], 'b')).toEqual(['a', 'b']);
    expect(basculerDansSelection(['a', 'b'], 'a')).toEqual(['b']);
    const s = ['a', 'b'];
    expect(selectionExistante(s, new Set(['a', 'b', 'c']))).toBe(s);
    expect(selectionExistante(s, new Set(['b']))).toEqual(['b']);
  });
});
