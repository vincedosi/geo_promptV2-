import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, UrlTree, provideRouter, type ActivatedRouteSnapshot, type RouterStateSnapshot } from '@angular/router';
import { DemarrageService } from '../demarrage/demarrage.service';
import { MODE_DEVELOPPEMENT } from '../environnement/mode-developpement';
import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { ConnexionAutoService } from './connexion-auto.service';
import { STRATEGIE_AUTONOME, STRATEGIE_SANS_SESSION, type StrategieSansSession } from './strategie-sans-session';

interface Options {
  erreur?: string;
  strategie?: StrategieSansSession;
  dev?: boolean;
  /** Résultat de la connexion automatique. */
  auto?: boolean;
}

function executer(connecte: boolean, url: string, opts: Options = {}) {
  const tenter = vi.fn(async () => opts.auto ?? false);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { connecte: signal(connecte) } },
      { provide: DemarrageService, useValue: { erreur: signal(opts.erreur ?? null) } },
      { provide: ConnexionAutoService, useValue: { tenter } },
      { provide: MODE_DEVELOPPEMENT, useValue: opts.dev ?? false },
      ...(opts.strategie ? [{ provide: STRATEGIE_SANS_SESSION, useValue: opts.strategie }] : []),
    ],
  });
  const resultat = TestBed.runInInjectionContext(() =>
    authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
  );
  return { resultat, tenter };
}

const serialiser = (r: unknown) => TestBed.inject(Router).serializeUrl(r as UrlTree);

describe('authGuard', () => {
  it('laisse passer un utilisateur connecté', () => {
    expect(executer(true, '/app', { strategie: STRATEGIE_AUTONOME }).resultat).toBe(true);
  });

  it('autonome : renvoie vers la connexion en gardant la page demandée', () => {
    const { resultat } = executer(false, '/app/risques?etape=2', { strategie: STRATEGIE_AUTONOME });
    expect(serialiser(resultat)).toBe('/connexion?redirection=%2Fapp%2Frisques%3Fetape%3D2');
  });

  it('lit le chemin dans STRATEGIE_SANS_SESSION, jamais un littéral', () => {
    const { resultat } = executer(false, '/app', { strategie: { mode: 'rediriger', chemin: '/ailleurs' } });
    expect(serialiser(resultat)).toBe('/ailleurs?redirection=%2Fapp');
  });

  it("hôte (défaut racine, mode message) : laisse passer, la racine affiche « Session requise » — jamais de navigation vers une page que l'hôte n'a pas", () => {
    expect(executer(false, '/hote/magelian').resultat).toBe(true);
  });

  it('démarrage en échec : laisse passer, la racine affiche l\'erreur (pas de renvoi vers la connexion)', () => {
    const { resultat } = executer(false, '/app', { erreur: 'Configuration locale introuvable.', strategie: STRATEGIE_AUTONOME });
    expect(resultat).toBe(true);
  });

  describe('connexion automatique de développement (2026-11-02)', () => {
    it('autonome en développement : tente la connexion auto AVANT de renvoyer vers /connexion, et laisse passer si elle réussit', async () => {
      const { resultat, tenter } = executer(false, '/app/catalogue', { strategie: STRATEGIE_AUTONOME, dev: true, auto: true });
      expect(await resultat).toBe(true);
      expect(tenter).toHaveBeenCalledTimes(1);
    });

    it('autonome en développement, connexion auto en échec : retombe sur /connexion avec la page demandée', async () => {
      const { resultat, tenter } = executer(false, '/app/catalogue', { strategie: STRATEGIE_AUTONOME, dev: true, auto: false });
      expect(serialiser(await resultat)).toBe('/connexion?redirection=%2Fapp%2Fcatalogue');
      expect(tenter).toHaveBeenCalledTimes(1);
    });

    it('autonome hors développement : aucune tentative, renvoi direct vers /connexion', () => {
      const { resultat, tenter } = executer(false, '/app', { strategie: STRATEGIE_AUTONOME, dev: false, auto: true });
      expect(serialiser(resultat)).toBe('/connexion?redirection=%2Fapp');
      expect(tenter).not.toHaveBeenCalled();
    });

    it('hôte AIDA (mode message), même en développement : inchangé — laisse passer sans aucune tentative', () => {
      const { resultat, tenter } = executer(false, '/hote/magelian', { dev: true, auto: true });
      expect(resultat).toBe(true);
      expect(tenter).not.toHaveBeenCalled();
    });

    it('une stratégie `rediriger` sans `connexionAuto` ne tente rien', () => {
      const { tenter } = executer(false, '/app', { strategie: { mode: 'rediriger', chemin: '/connexion' }, dev: true, auto: true });
      expect(tenter).not.toHaveBeenCalled();
    });

    it('déjà connecté : aucune tentative', () => {
      const { resultat, tenter } = executer(true, '/app', { strategie: STRATEGIE_AUTONOME, dev: true, auto: true });
      expect(resultat).toBe(true);
      expect(tenter).not.toHaveBeenCalled();
    });

    it('démarrage en échec : aucune tentative, l\'erreur prime', () => {
      const { resultat, tenter } = executer(false, '/app', { erreur: 'x', strategie: STRATEGIE_AUTONOME, dev: true, auto: true });
      expect(resultat).toBe(true);
      expect(tenter).not.toHaveBeenCalled();
    });
  });
});
