import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, UrlTree, provideRouter, type ActivatedRouteSnapshot, type RouterStateSnapshot } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';

function executer(connecte: boolean, url: string) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: AuthService, useValue: { connecte: signal(connecte) } }],
  });
  return TestBed.runInInjectionContext(() =>
    authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
  );
}

describe('authGuard', () => {
  it('laisse passer un utilisateur connecté', () => {
    expect(executer(true, '/')).toBe(true);
  });

  it('renvoie vers la connexion en gardant la page demandée', () => {
    const r = executer(false, '/risques?etape=2') as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(r)).toBe('/connexion?redirection=%2Frisques%3Fetape%3D2');
  });
});
