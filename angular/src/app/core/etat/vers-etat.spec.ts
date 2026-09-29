import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, throwError } from 'rxjs';
import { versEtat } from './vers-etat';

describe('versEtat', () => {
  it('commence en chargement, puis passe à pret avec la valeur', () => {
    const source$ = new Subject<number>();
    const etat = TestBed.runInInjectionContext(() => versEtat(source$));

    expect(etat()).toEqual({ statut: 'chargement' });

    source$.next(42);

    expect(etat()).toEqual({ statut: 'pret', valeur: 42 });
  });

  it('passe à echec avec un message français, jamais un chargement sans fin', () => {
    const etat = TestBed.runInInjectionContext(() =>
      versEtat(throwError(() => new HttpErrorResponse({ status: 504 }))),
    );

    const e = etat();
    expect(e.statut).toBe('echec');
    if (e.statut === 'echec') {
      expect(e.message).toMatch(/API ne répond pas/);
    }
  });
});
