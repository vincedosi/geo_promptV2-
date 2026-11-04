import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationStart, Router, provideRouter, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService } from '../core/auth/auth.service';
import { ConnexionAutoService } from '../core/auth/connexion-auto.service';
import {
  MESSAGE_CONNEXION_AUTO_ECHOUEE,
  MESSAGE_SANS_SESSION,
  MESSAGE_SESSION_FERMEE_LOCALE,
  STRATEGIE_AUTONOME,
  STRATEGIE_SANS_SESSION,
} from '../core/auth/strategie-sans-session';
import { MODE_DEVELOPPEMENT } from '../core/environnement/mode-developpement';
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

function preparer(opts: { erreur?: string; authCassee?: boolean; hote?: boolean; dev?: boolean; echec?: boolean } = {}) {
  const connecte = signal(true);
  let debloquer!: (v: boolean) => void;
  const lent = new Promise<boolean>((r) => (debloquer = r));
  const routes: Routes = [
    {
      path: '',
      component: RacineDistanteComponent,
      providers: opts.hote ? [] : [{ provide: STRATEGIE_SANS_SESSION, useValue: STRATEGIE_AUTONOME }],
      children: [
        { path: '', component: PageVide },
        { path: 'lent', canActivate: [() => lent], component: PageVide },
      ],
    },
  ];
  const constructions = { auth: 0 };
  const feuilles = feuillesFactices();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter(routes),
      ...feuilles.providers,
      { provide: MODE_DEVELOPPEMENT, useValue: opts.dev ?? true },
      { provide: ConnexionAutoService, useValue: { echec: signal(opts.echec ?? false) } },
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

describe('RacineDistanteComponent — sans session : un message en place, jamais de navigation (plus de page de connexion, 2026-11-05)', () => {
  const statut = (harness: RouterTestingHarness) =>
    ombre(harness.fixture.nativeElement as HTMLElement).querySelector('[role="status"]')?.textContent?.trim();

  it('autonome en développement, session fermée en cours de page : « Session fermée — rechargez… », aucune navigation, pages retirées', async () => {
    const { connecte, debloquer, navigations } = preparer();
    const harness = await RouterTestingHarness.create('/');
    void TestBed.inject(Router).navigateByUrl('/lent');
    await laisserTourner(harness);
    debloquer();
    await laisserTourner(harness);
    connecte.set(false);
    await laisserTourner(harness);
    expect(navigations).toEqual(['/', '/lent']);
    expect(statut(harness)).toBe(MESSAGE_SESSION_FERMEE_LOCALE);
    expect(ombre(harness.fixture.nativeElement as HTMLElement).querySelector('mg-vide')).toBeNull();
  });

  it('autonome en développement, connexion automatique en échec : dit de vérifier DEV_CONNEXION_AUTO_*', async () => {
    const { connecte } = preparer({ echec: true });
    connecte.set(false);
    const harness = await RouterTestingHarness.create('/');
    await laisserTourner(harness);
    expect(statut(harness)).toBe(MESSAGE_CONNEXION_AUTO_ECHOUEE);
    expect(MESSAGE_CONNEXION_AUTO_ECHOUEE).toContain('DEV_CONNEXION_AUTO_');
    expect(MESSAGE_CONNEXION_AUTO_ECHOUEE).toContain('.env.development.local');
  });

  it('autonome hors développement : le message AIDA', async () => {
    const { connecte } = preparer({ dev: false, echec: true });
    connecte.set(false);
    const harness = await RouterTestingHarness.create('/');
    await laisserTourner(harness);
    expect(statut(harness)).toBe(MESSAGE_SANS_SESSION);
  });

  it('hôte AIDA : le message AIDA, même en développement', async () => {
    const { connecte, navigations } = preparer({ hote: true, echec: true });
    connecte.set(false);
    const harness = await RouterTestingHarness.create('/');
    await laisserTourner(harness);
    expect(statut(harness)).toBe(MESSAGE_SANS_SESSION);
    expect(navigations).toEqual(['/']);
  });

  it("la session revient : la page s'affiche sans renavigation", async () => {
    const { connecte, navigations } = preparer();
    connecte.set(false);
    const harness = await RouterTestingHarness.create('/');
    await laisserTourner(harness);
    connecte.set(true);
    await laisserTourner(harness);
    expect(ombre(harness.fixture.nativeElement as HTMLElement).querySelector('mg-vide')).not.toBeNull();
    expect(navigations).toEqual(['/']);
  });

  it("démarrage en échec : ni navigation ni construction de AuthService, le message d'erreur prime", async () => {
    const { navigations, constructions } = preparer({ erreur: 'Configuration locale introuvable.', authCassee: true });
    const harness = await RouterTestingHarness.create('/');
    await laisserTourner(harness);

    expect(navigations).toEqual(['/']);
    expect(constructions.auth).toBe(0);
    const racine = ombre(harness.fixture.nativeElement as HTMLElement);
    expect(racine.querySelector('[role="alert"]')?.textContent).toContain('Configuration locale introuvable.');
    expect(racine.querySelector('[role="status"]')).toBeNull();
  });
});
