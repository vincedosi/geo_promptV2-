import { describe, it, expect, beforeEach } from 'vitest';
import { empiler, depiler, fermerLePlusHaut, etatPile } from '@/lib/carte/pile-echap';

beforeEach(() => { etatPile().length = 0; });

describe('pile Echap', () => {
  it('ferme le dernier ouvert en premier', () => {
    const ordre: string[] = [];
    empiler('overlay', () => ordre.push('overlay'));
    empiler('modale', () => ordre.push('modale'));
    fermerLePlusHaut();
    expect(ordre).toEqual(['modale']);
    fermerLePlusHaut();
    expect(ordre).toEqual(['modale', 'overlay']);
  });

  it('depiler retire une entree sans la fermer', () => {
    const ordre: string[] = [];
    empiler('modale', () => ordre.push('modale'));
    depiler('modale');
    fermerLePlusHaut();
    expect(ordre).toEqual([]);
  });

  it('ne casse pas quand la pile est vide', () => {
    expect(() => fermerLePlusHaut()).not.toThrow();
  });
});
