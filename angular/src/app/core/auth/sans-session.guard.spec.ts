import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, UrlTree, provideRouter, type ActivatedRouteSnapshot, type RouterStateSnapshot } from '@angular/router';
import { AuthService } from './auth.service';
import { sansSessionGuard } from './sans-session.guard';

function executer(connecte: boolean) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: AuthService, useValue: { connecte: signal(connecte) } }],
  });
  return TestBed.runInInjectionContext(() =>
    sansSessionGuard({} as ActivatedRouteSnapshot, { url: '/connexion' } as RouterStateSnapshot),
  );
}

describe('sansSessionGuard', () => {
  it('laisse la page de connexion à un visiteur non connecté', () => {
    expect(executer(false)).toBe(true);
  });
  it('renvoie un utilisateur connecté vers l\'accueil de l\'application (/app)', () => {
    const r = executer(true) as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(r)).toBe('/app');
  });
});
