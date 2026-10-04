import { TestBed } from '@angular/core/testing';
import { PileEchapService } from './pile-echap.service';

/** Cas de `tests/unit/carte/pile-echap.test.ts` (React), plus l'absence d'état global. */
describe('PileEchapService', () => {
  let pile: PileEchapService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [PileEchapService] });
    pile = TestBed.inject(PileEchapService);
  });

  it('ferme le dernier ouvert en premier', () => {
    const ordre: string[] = [];
    pile.empiler('overlay', () => ordre.push('overlay'));
    pile.empiler('modale', () => ordre.push('modale'));
    pile.fermerLePlusHaut();
    expect(ordre).toEqual(['modale']);
    pile.fermerLePlusHaut();
    expect(ordre).toEqual(['modale', 'overlay']);
    expect(pile.etat()).toEqual([]);
  });

  it('depiler retire une entrée sans la fermer', () => {
    const ordre: string[] = [];
    pile.empiler('modale', () => ordre.push('modale'));
    pile.depiler('modale');
    pile.fermerLePlusHaut();
    expect(ordre).toEqual([]);
  });

  it('depiler un id absent est sans effet', () => {
    pile.empiler('a', () => undefined);
    pile.depiler('inconnu');
    expect(pile.etat().map((e) => e.id)).toEqual(['a']);
  });

  it('ne casse pas quand la pile est vide', () => {
    expect(() => pile.fermerLePlusHaut()).not.toThrow();
    expect(pile.etat()).toEqual([]);
  });

  it('ré-empiler un id présent garde sa position et remplace sa fonction (Assistant re-rendu à chaque jeton)', () => {
    const ordre: string[] = [];
    pile.empiler('A', () => ordre.push('A-ancien'));
    pile.empiler('B', () => ordre.push('B'));
    pile.empiler('A', () => ordre.push('A-nouveau'));
    expect(pile.etat().map((e) => e.id)).toEqual(['A', 'B']);
    pile.fermerLePlusHaut();
    expect(ordre).toEqual(['B']);
    pile.fermerLePlusHaut();
    expect(ordre).toEqual(['B', 'A-nouveau']);
  });

  it('deux instances n’ont aucun état commun (pile fournie par la page, jamais globale)', () => {
    const autre = new PileEchapService();
    const ordre: string[] = [];
    pile.empiler('a', () => ordre.push('a'));
    autre.fermerLePlusHaut();
    expect(ordre).toEqual([]);
    expect(autre.etat()).toEqual([]);
    expect(pile.etat().map((e) => e.id)).toEqual(['a']);
  });

  it('etat() expose une vue, pas la pile elle-même', () => {
    pile.empiler('a', () => undefined);
    const vue = pile.etat() as { id: string }[];
    vue.length = 0;
    expect(pile.etat().map((e) => e.id)).toEqual(['a']);
  });
});
