import { TestBed } from '@angular/core/testing';
import { EnvironmentInjector, computed, createEnvironmentInjector } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, Subject, of, throwError } from 'rxjs';
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

  it('émet chargement de façon synchrone, avant toute émission de la source', () => {
    const etat = TestBed.runInInjectionContext(() => versEtat(new Subject<number>()));
    // Lu dans la même tâche, sans attente : un `{ statut: 'chargement' }` différé
    // ferait lire `undefined` au premier rendu du `@switch`.
    expect(etat()).toEqual({ statut: 'chargement' });
  });

  it('passe à pret de façon synchrone quand la source émet tout de suite', () => {
    const etat = TestBed.runInInjectionContext(() => versEtat(of(7)));
    expect(etat()).toEqual({ statut: 'pret', valeur: 7 });
  });

  it("se désabonne à la destruction de l'injecteur", () => {
    let abonnes = 0;
    let desabonnes = 0;
    const source$ = new Observable<number>(() => {
      abonnes++;
      return () => desabonnes++;
    });
    const injecteur = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
    const etat = injecteur.runInContext(() => versEtat(source$));

    expect(abonnes).toBe(1);
    expect(desabonnes).toBe(0);
    injecteur.destroy();
    expect(desabonnes).toBe(1);
    expect(etat()).toEqual({ statut: 'chargement' });
  });

  it("lève une erreur claire DANS un contexte réactif (computed, effect, gabarit) — comme l'ancien toSignal", () => {
    // Dans un `computed`, chaque réévaluation créerait un nouvel abonnement HTTP.
    const derive = computed(() => TestBed.runInInjectionContext(() => versEtat(of(1))));
    expect(() => derive()).toThrowError(/NG0602.*versEtat\(\)/);
  });

  it("lève une erreur claire hors d'un contexte d'injection", () => {
    // Le message NOMME versEtat : l'appelant doit savoir quelle fonction est mal placée.
    expect(() => versEtat(new Subject<number>())).toThrowError(/NG0203.*versEtat\(\)/);
  });
});
