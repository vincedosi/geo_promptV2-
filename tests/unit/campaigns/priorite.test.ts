/**
 * @file tests/unit/campaigns/priorite.test.ts — réordonnancement des zones
 * cibles (Tâche 21, 2026-09-13).
 *
 * Les cinq premiers cas sont VERBATIM du plan. Les suivants couvrent ce qu'un
 * glisser-déposer réel produit : un index négatif (relâché au-dessus de la
 * liste), une destination au-delà de la dernière ligne (relâché en dessous),
 * et les entrées dégénérées.
 */
import { describe, it, expect } from 'vitest';
import { deplacer } from '@/lib/campaigns/priorite';

describe('reordonnancement des zones cibles', () => {
  it('deplace un element vers le haut', () => {
    expect(deplacer(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });
  it('deplace un element vers le bas', () => {
    expect(deplacer(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });
  it('ne change rien quand la position est identique', () => {
    expect(deplacer(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
  it('ne mute pas le tableau d entree', () => {
    const src = ['a', 'b'];
    deplacer(src, 0, 1);
    expect(src).toEqual(['a', 'b']);
  });
  it('ignore un index hors bornes', () => {
    expect(deplacer(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });

  // ── Ce qu'un glisser-déposer réel produit ──────────────────────────────
  it('ignore un index de depart negatif', () => {
    expect(deplacer(['a', 'b', 'c'], -1, 0)).toEqual(['a', 'b', 'c']);
  });
  it('ignore une destination hors bornes', () => {
    // Relâché sous la dernière ligne : mieux vaut ne rien faire que de perdre
    // l'élément ou de le dupliquer.
    expect(deplacer(['a', 'b', 'c'], 0, 9)).toEqual(['a', 'b', 'c']);
    expect(deplacer(['a', 'b', 'c'], 0, -2)).toEqual(['a', 'b', 'c']);
  });
  it('ignore un index non entier', () => {
    expect(deplacer(['a', 'b', 'c'], 0.5, 2)).toEqual(['a', 'b', 'c']);
    expect(deplacer(['a', 'b', 'c'], NaN, 1)).toEqual(['a', 'b', 'c']);
  });
  it('gere une liste vide ou a un element', () => {
    expect(deplacer([], 0, 0)).toEqual([]);
    expect(deplacer(['a'], 0, 0)).toEqual(['a']);
  });
  it('conserve TOUS les elements, quel que soit le deplacement', () => {
    const source = ['a', 'b', 'c', 'd', 'e'];
    for (let de = 0; de < source.length; de++) {
      for (let vers = 0; vers < source.length; vers++) {
        const r = deplacer(source, de, vers);
        expect(r).toHaveLength(source.length);
        expect([...r].sort()).toEqual([...source].sort());
      }
    }
  });
  it('fonctionne sur des objets, pas seulement des chaines', () => {
    const z = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(deplacer(z, 2, 0).map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });
});
