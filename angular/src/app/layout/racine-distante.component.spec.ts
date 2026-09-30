import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationStart, Router, provideRouter, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService } from '../core/auth/auth.service';
import { STRATEGIE_AUTONOME, STRATEGIE_SANS_SESSION } from '../core/auth/strategie-sans-session';
import { DemarrageService } from '../core/demarrage/demarrage.service';
import { feuillesFactices, ombre } from '../core/ressources/testing/feuilles-factices';
import { ThemeService } from '../core/theme/theme.service';
import { RacineDistanteComponent } from './racine-distante.component';

@Component({ selector: 'mg-vide', template: '<p>page</p>' })
class PageVide {}

const attendre = () => new Promise((r) => setTimeout(r, 0));

/** Laisse l'effet, la détection de changement et le routeur aller au bout, sans `whenStable` (une navigation peut rester pendante). */
async function laisserTourner(harness: RouterTestingHarness) {
  for (let i = 0; i < 3; i++) {
    await attendre();
    harness.fixture.detectChanges();
  }
}

function preparer(opts: { erreur?: string; authCassee?: boolean } = {}) {
  const connecte = signal(true);
  let debloquer!: (v: boolean) => void;
  const lent = new Promise<boolean>((r) => (debloquer = r));
  const routes: Routes = [
    {
      path: '',
      component: RacineDistanteComponent,
      providers: [{ provide: STRATEGIE_SANS_SESSION, useValue: STRATEGIE_AUTONOME }],
      children: [
        { path: '', component: PageVide },
        { path: 'lent', canActivate: [() => lent], component: PageVide },
      ],
    },
    { path: 'connexion', component: PageVide },
  ];
  const constructions = { auth: 0 };
  const feuilles = feuillesFactices();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter(routes),
      ...feuilles.providers,
      { provide: DemarrageService, useValue: { erreur: signal(opts.erreur ?? null), feuille: signal(feuilles.feuille) } },
      {
        provide: AuthService,
        useFactory: () => {
          constructions.auth++;
          // Démarrage en échec : le vrai AuthService ne peut pas se construire.
          if (opts.authCassee) throw new Error('Configuration pas encore chargée.');
          return { connecte };
        },
      },
    ],
  });
  const navigations: string[] = [];
  TestBed.inject(Router).events.subscribe((e) => {
    if (e instanceof NavigationStart) navigations.push(e.url);
  });
  return { connecte, debloquer: () => debloquer(true), navigations, constructions, feuilles };
}

describe('RacineDistanteComponent — racine d\'ombre (isolation CSS)', () => {
  it('rend dans SA racine d\'ombre, adopte la feuille globale et y reflète le thème sur son hôte', async () => {
    const { feuilles } = preparer();
    const harness = await RouterTestingHarness.create('/');
    await laisserTourner(harness);
    const hote = (harness.fixture.nativeElement as HTMLElement).querySelector('mg-racine-distante')!;
    const racine = ombre(harness.fixture.nativeElement as HTMLElement);
    expect(racine.querySelector('mg-vide')).not.toBeNull();
    expect(feuilles.adoptions).toEqual([{ racine, feuille: feuilles.feuille }]);
    const theme = TestBed.inject(ThemeService);
    expect(theme.racine()).toBe(hote);
    expect(hote.classList.contains(theme.themeApplique())).toBe(true);
  });

  it('démontée, elle se désenregistre : CouleursService ne lit plus un élément détaché', async () => {
    preparer();
    const harness = await RouterTestingHarness.create('/');
    await laisserTourner(harness);
    expect(TestBed.inject(ThemeService).racine()).not.toBeNull();
    harness.fixture.destroy();
    expect(TestBed.inject(ThemeService).racine()).toBeNull();
  });
});

describe('RacineDistanteComponent — mode rediriger (lancement autonome)', () => {
  it("n'interrompt pas une navigation en cours : attend sa fin, puis renvoie vers la connexion avec la page atteinte", async () => {
    const { connecte, debloquer, navigations } = preparer();
    const harness = await RouterTestingHarness.create('/');
    const router = TestBed.inject(Router);

    void router.navigateByUrl('/lent');
    await laisserTourner(harness);
    connecte.set(false);
    await laisserTourner(harness);
    // Pendant la navigation : l'effet s'abstient — sinon il annulerait celle
    // du badge de session (« Deconnexion » → /connexion sans page à reprendre).
    expect(navigations).toEqual(['/', '/lent']);

    debloquer();
    await laisserTourner(harness);
    // Fin de navigation, racine toujours là, toujours sans session : il redirige.
    expect(navigations).toEqual(['/', '/lent', '/connexion?redirection=%2Flent']);
    expect(router.url).toBe('/connexion?redirection=%2Flent');
  });

  it('démarrage en échec : ni redirection ni construction de AuthService, le message d\'erreur prime', async () => {
    const { navigations, constructions } = preparer({ erreur: 'Configuration locale introuvable.', authCassee: true });
    const harness = await RouterTestingHarness.create('/');
    await laisserTourner(harness);

    expect(navigations).toEqual(['/']);
    expect(constructions.auth).toBe(0);
    const racine = ombre(harness.fixture.nativeElement as HTMLElement);
    expect(racine.querySelector('[role="alert"]')?.textContent).toContain('Configuration locale introuvable.');
    expect(racine.querySelector('[role="status"]')).toBeNull();
  });

  it("n'affiche jamais « Session requise » en mode rediriger", async () => {
    const { connecte, debloquer } = preparer();
    const harness = await RouterTestingHarness.create('/');
    void TestBed.inject(Router).navigateByUrl('/lent');
    connecte.set(false);
    await laisserTourner(harness);
    expect(ombre(harness.fixture.nativeElement as HTMLElement).querySelector('[role="status"]')).toBeNull();
    debloquer();
    await laisserTourner(harness);
  });
});
