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

  it('re-empiler un id deja present conserve sa position (round de correction 1)', () => {
    // Un composant dont le callback de fermeture change d'identite a chaque
    // rendu (onClose inline, handleClose qui en depend) ne doit PAS remonter
    // au sommet de la pile a chaque re-rendu — seule une VRAIE ouverture doit
    // le faire. Sans ce comportement, un Assistant qui re-rend a chaque jeton
    // de streaming reprend le sommet sur une Campagne ouverte par-dessus, et
    // Echap ferme le mauvais overlay.
    const ordre: string[] = [];
    empiler('A', () => ordre.push('A'));
    empiler('B', () => ordre.push('B'));
    empiler('A', () => ordre.push('A')); // re-empilage : A ne doit pas remonter
    fermerLePlusHaut();
    expect(ordre).toEqual(['B']);
    fermerLePlusHaut();
    expect(ordre).toEqual(['B', 'A']);
  });
});
