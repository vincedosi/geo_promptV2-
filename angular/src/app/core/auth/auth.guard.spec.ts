import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, UrlTree, provideRouter, type ActivatedRouteSnapshot, type RouterStateSnapshot } from '@angular/router';
import { DemarrageService } from '../demarrage/demarrage.service';
import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { CHEMIN_CONNEXION } from './chemin-connexion';

function executer(connecte: boolean, url: string, opts: { erreur?: string; chemin?: string } = {}) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { connecte: signal(connecte) } },
      { provide: DemarrageService, useValue: { erreur: signal(opts.erreur ?? null) } },
      ...(opts.chemin ? [{ provide: CHEMIN_CONNEXION, useValue: opts.chemin }] : []),
    ],
  });
  return TestBed.runInInjectionContext(() =>
    authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
  );
}

describe('authGuard', () => {
  it('laisse passer un utilisateur connecté', () => {
    expect(executer(true, '/app')).toBe(true);
  });

  it('renvoie vers la connexion en gardant la page demandée', () => {
    const r = executer(false, '/app/risques?etape=2') as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(r)).toBe('/connexion?redirection=%2Fapp%2Frisques%3Fetape%3D2');
  });

  it('lit la page de connexion dans CHEMIN_CONNEXION, jamais un littéral', () => {
    const r = executer(false, '/app', { chemin: '/ailleurs' }) as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(r)).toBe('/ailleurs?redirection=%2Fapp');
  });

  it('démarrage en échec : laisse passer, la racine affiche l\'erreur (pas de renvoi vers la connexion)', () => {
    expect(executer(false, '/app', { erreur: 'Configuration locale introuvable.' })).toBe(true);
  });
});
