import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter, type Route } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ConfigService } from '../../../core/config/config.service';
import { ROUTES_ADMIN } from '../admin.routes';
import { FraicheurApi } from '../health/data/fraicheur.api';
import { HealthApi } from '../health/data/health.api';
import { FraicheurEtatService } from '../health/etat/fraicheur-etat.service';
import { SanteService } from '../health/etat/sante.service';
import { SystemePage } from './systeme.page';

const DIAGNOSTIC = { success: true, status: 'OK', summary: 'Tout va bien', checks: [], timestamp: '' };
const RELEVE = { sources: [], mesureLe: null, dureeMs: null };

/** La VRAIE route `systeme` de ROUTES_ADMIN (enfants, redirection), sous un préfixe d'hôte, sans le garde. */
async function monter(url: string) {
  const systeme = (ROUTES_ADMIN[0].children ?? []).find((r) => r.path === 'systeme') as Route;
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), HealthApi, FraicheurApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      provideRouter([{ path: 'hote/app/admin', children: [systeme] }]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await harness.fixture.whenStable();
  const el = harness.fixture.nativeElement as HTMLElement;
  return {
    harness, el,
    http: TestBed.inject(HttpTestingController),
    router: TestBed.inject(Router),
    onglets: () => [...el.querySelectorAll<HTMLAnchorElement>('mg-systeme [role="tab"]')],
    stable: () => harness.fixture.whenStable(),
  };
}

describe('SystemePage — page Système à onglets (lot 6, T6)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('`systeme` mène à `systeme/sante` : titre « Système », deux onglets, Santé actif, UNE lecture du diagnostic', async () => {
    const { el, http, router, onglets, harness } = await monter('/hote/app/admin/systeme');
    expect(router.url).toBe('/hote/app/admin/systeme/sante');
    expect(harness.routeNativeElement).toBeTruthy();
    expect(el.querySelector('mg-systeme h1')?.textContent?.trim()).toBe('Système');
    expect(onglets().map((a) => a.textContent!.trim())).toEqual(['Santé', 'Fraîcheur des données']);
    expect(onglets().map((a) => a.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect(onglets().map((a) => a.getAttribute('href'))).toEqual([
      '/hote/app/admin/systeme/sante', '/hote/app/admin/systeme/fraicheur',
    ]);
    // Une seule barre : l'ancienne barre interne du Health check a disparu.
    expect(el.querySelectorAll('[role="tablist"]').length).toBe(1);
    expect(el.querySelector('mg-systeme mg-health')).not.toBeNull();
    http.expectOne('/api/admin/health').flush(DIAGNOSTIC);
    http.expectNone('/api/admin/fraicheur-donnees');
  });

  it('chargement DIRECT sur `systeme/fraicheur` : Fraîcheur aria-selected, UN GET du relevé, aucun diagnostic lu', async () => {
    const { el, http, onglets } = await monter('/hote/app/admin/systeme/fraicheur');
    expect(onglets().map((a) => a.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    expect(el.querySelector('mg-fraicheur')).not.toBeNull();
    const req = http.expectOne('/api/admin/fraicheur-donnees');
    expect(req.request.method).toBe('GET');
    req.flush(RELEVE);
    http.expectNone('/api/admin/health');
  });

  it('aller-retour Santé ↔ Fraîcheur deux fois : UN diagnostic et UN relevé en tout (état porté par la page)', async () => {
    const { el, http, onglets, stable, router } = await monter('/hote/app/admin/systeme/sante');
    http.expectOne('/api/admin/health').flush(DIAGNOSTIC);
    onglets()[1].click();
    await stable();
    http.expectOne('/api/admin/fraicheur-donnees').flush(RELEVE);
    for (let i = 0; i < 2; i++) {
      onglets()[0].click();
      await stable();
      expect(router.url).toBe('/hote/app/admin/systeme/sante');
      expect(el.querySelector('[data-resume]')?.textContent?.trim()).toBe('Tout va bien');
      onglets()[1].click();
      await stable();
      expect(el.querySelector('mg-fraicheur')).not.toBeNull();
    }
    http.expectNone('/api/admin/health');
    http.expectNone('/api/admin/fraicheur-donnees');
  });

  it('la page fournit l’état de ses onglets (aucun `providedIn`) : deux pages = deux états', () => {
    // Monter la page hors routeur suffit à vérifier qu'elle porte ses fournisseurs.
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), HealthApi, FraicheurApi, provideRouter([]),
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    expect(TestBed.inject(SanteService, null)).toBeNull();
    expect(TestBed.inject(FraicheurEtatService, null)).toBeNull();
    const a = TestBed.createComponent(SystemePage);
    const b = TestBed.createComponent(SystemePage);
    const sante = (f: typeof a) => f.componentRef.injector.get(SanteService);
    const fraicheur = (f: typeof a) => f.componentRef.injector.get(FraicheurEtatService);
    expect(sante(a)).not.toBe(sante(b));
    expect(fraicheur(a)).not.toBe(fraicheur(b));
  });
});
