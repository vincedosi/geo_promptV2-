import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, UrlTree, provideRouter, type ActivatedRouteSnapshot, type RouterStateSnapshot } from '@angular/router';
import { DemarrageService } from '../demarrage/demarrage.service';
import { AuthService } from './auth.service';
import { sansSessionGuard } from './sans-session.guard';

function executer(connecte: boolean, opts: { erreur?: string } = {}) {
  const ordre: string[] = [];
  const erreur = signal<string | null>(null);
  const demarrage = {
    erreur,
    demarrer: vi.fn(async () => {
      // Asynchrone pour de vrai : un garde qui n'ATTEND pas `demarrer()` lirait
      // la session avant que ceci n'ait rien enregistré ni posé l'erreur.
      await Promise.resolve();
      ordre.push('demarrage');
      erreur.set(opts.erreur ?? null);
    }),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: DemarrageService, useValue: demarrage },
      {
        provide: AuthService,
        useFactory: () => {
          ordre.push('auth');
          // Démarrage en échec : le client Supabase ne peut pas se construire —
          // injecter AuthService lèverait. Le garde ne doit donc PAS y toucher.
          if (opts.erreur) throw new Error('Configuration pas encore chargée.');
          return { connecte: signal(connecte) };
        },
      },
    ],
  });
  const resultat = TestBed.runInInjectionContext(() =>
    sansSessionGuard({} as ActivatedRouteSnapshot, { url: '/connexion' } as RouterStateSnapshot),
  ) as Promise<boolean | UrlTree>;
  return { resultat, ordre };
}

describe('sansSessionGuard', () => {
  it('laisse la page de connexion à un visiteur non connecté', async () => {
    expect(await executer(false).resultat).toBe(true);
  });

  it('renvoie un utilisateur connecté vers l\'accueil de l\'application (/app)', async () => {
    const r = (await executer(true).resultat) as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(r)).toBe('/app');
  });

  it('attend le démarrage AVANT de lire la session : les gardes d\'une route partent en même temps', async () => {
    const { resultat, ordre } = executer(false);
    await resultat;
    expect(ordre).toEqual(['demarrage', 'auth']);
  });

  it('démarrage en échec : laisse passer SANS injecter AuthService — la page affiche l\'erreur', async () => {
    const { resultat, ordre } = executer(false, { erreur: 'Configuration locale introuvable.' });
    expect(await resultat).toBe(true);
    expect(ordre).toEqual(['demarrage']);
  });
});
