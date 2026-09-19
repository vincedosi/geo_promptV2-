import { describe, it, expect } from 'vitest';
import { ignorerRaccourciClavier } from '@/lib/navigation/garde-saisie';

/** Fabrique un élément minimal sans monter de vrai DOM. */
function element(tagName: string, isContentEditable = false): Element {
  return { tagName, isContentEditable } as unknown as Element;
}

describe('ignorerRaccourciClavier', () => {
  it('ne filtre jamais Echap, focus dans un champ ou non', () => {
    expect(ignorerRaccourciClavier('Escape', element('INPUT'))).toBe(false);
    expect(ignorerRaccourciClavier('Escape', element('TEXTAREA'))).toBe(false);
    expect(ignorerRaccourciClavier('Escape', element('DIV', true))).toBe(false);
    expect(ignorerRaccourciClavier('Escape', null)).toBe(false);
  });

  it('filtre un raccourci a modificateur quand le focus est dans un champ', () => {
    expect(ignorerRaccourciClavier('k', element('INPUT'))).toBe(true);
    expect(ignorerRaccourciClavier('1', element('TEXTAREA'))).toBe(true);
    expect(ignorerRaccourciClavier('c', element('DIV', true))).toBe(true);
  });

  it('ne filtre pas un raccourci a modificateur hors d un champ de saisie', () => {
    expect(ignorerRaccourciClavier('k', element('DIV'))).toBe(false);
    expect(ignorerRaccourciClavier('1', element('BUTTON'))).toBe(false);
    expect(ignorerRaccourciClavier('c', null)).toBe(false);
  });
});
