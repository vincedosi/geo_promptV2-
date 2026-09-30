import { TestBed } from '@angular/core/testing';
import { MODE_DEVELOPPEMENT } from './mode-developpement';

describe('MODE_DEVELOPPEMENT', () => {
  it('vaut isDevMode() par défaut : vrai sous les tests, comme `npm start`', () => {
    expect(TestBed.inject(MODE_DEVELOPPEMENT)).toBe(true);
  });

  it('se remplace par un fournisseur (un test peut simuler la production)', () => {
    TestBed.configureTestingModule({ providers: [{ provide: MODE_DEVELOPPEMENT, useValue: false }] });
    expect(TestBed.inject(MODE_DEVELOPPEMENT)).toBe(false);
  });
});
