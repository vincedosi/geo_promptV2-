import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, UrlTree, provideRouter, type ActivatedRouteSnapshot, type RouterStateSnapshot } from '@angular/router';
import { DemarrageService } from '../demarrage/demarrage.service';
import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { STRATEGIE_AUTONOME, STRATEGIE_SANS_SESSION, type StrategieSansSession } from './strategie-sans-session';

function executer(connecte: boolean, url: string, opts: { erreur?: string; strategie?: StrategieSansSession } = {}) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { connecte: signal(connecte) } },
      { provide: DemarrageService, useValue: { erreur: signal(opts.erreur ?? null) } },
      ...(opts.strategie ? [{ provide: STRATEGIE_SANS_SESSION, useValue: opts.strategie }] : []),
    ],
  });
  return TestBed.runInInjectionContext(() =>
    authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
  );
}

describe('authGuard', () => {
  it('laisse passer un utilisateur connecté', () => {
    expect(executer(true, '/app', { strategie: STRATEGIE_AUTONOME })).toBe(true);
  });

  it('autonome : renvoie vers la connexion en gardant la page demandée', () => {
    const r = executer(false, '/app/risques?etape=2', { strategie: STRATEGIE_AUTONOME }) as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(r)).toBe('/connexion?redirection=%2Fapp%2Frisques%3Fetape%3D2');
  });

  it('lit le chemin dans STRATEGIE_SANS_SESSION, jamais un littéral', () => {
    const r = executer(false, '/app', { strategie: { mode: 'rediriger', chemin: '/ailleurs' } }) as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(r)).toBe('/ailleurs?redirection=%2Fapp');
  });

  it("hôte (défaut racine, mode message) : laisse passer, la racine affiche « Session requise » — jamais de navigation vers une page que l'hôte n'a pas", () => {
    expect(executer(false, '/hote/magelian')).toBe(true);
  });

  it('démarrage en échec : laisse passer, la racine affiche l\'erreur (pas de renvoi vers la connexion)', () => {
    expect(executer(false, '/app', { erreur: 'Configuration locale introuvable.', strategie: STRATEGIE_AUTONOME })).toBe(true);
  });
});
