import { MESSAGE_AUCUN_LINE_ITEM, MESSAGE_TROP_DE_LINE_ITEMS, lireLineItems, refusLineItems } from './line-items';

/** Le parsing de React, recopié de `ActivationPanel.tsx:166-170` pour la parité. */
const react = (s: string) => s.split(/[\s,;]+/).map((v) => v.trim()).filter((v) => /^\d+$/.test(v));

describe('lireLineItems — parité avec React', () => {
  const CAS = ['', '   ', '123', '1, 2;3\n4\t5', '12 abc 34', '  7,,8 ;; 9  ', '1.5 2-3 44', '0012 0012', '١٢٣ 5'];

  it.each(CAS)('« %s » : mêmes identifiants, dans le même ordre', (s) => {
    expect(lireLineItems(s).ids).toEqual(react(s));
  });

  it('compte les jetons écartés', () => {
    expect(lireLineItems('12 abc 34 1.5').invalides).toBe(2);
    expect(lireLineItems(' , ; ').invalides).toBe(0);
  });
});

describe('refusLineItems', () => {
  it('aucun identifiant : le message de React', () => {
    expect(refusLineItems(lireLineItems('abc'))).toBe(MESSAGE_AUCUN_LINE_ITEM);
    expect(MESSAGE_AUCUN_LINE_ITEM).toBe('Aucun identifiant de line item valide (chiffres uniquement).');
  });

  it('50 passent, 51 sont refusés (« 50 line items au plus »)', () => {
    const liste = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1)).join(',');
    expect(refusLineItems(lireLineItems(liste(50)))).toBeNull();
    expect(refusLineItems(lireLineItems(liste(51)))).toBe(MESSAGE_TROP_DE_LINE_ITEMS);
    expect(MESSAGE_TROP_DE_LINE_ITEMS).toBe('50 line items au plus.');
  });
});
