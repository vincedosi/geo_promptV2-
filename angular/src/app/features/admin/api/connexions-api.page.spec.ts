import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter, type Route } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ConfigService } from '../../../core/config/config.service';
import { BASE_RESSOURCES } from '../../../core/ressources/ressource-distante';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { ROUTES_ADMIN } from '../admin.routes';
import { FraicheurApi } from '../health/data/fraicheur.api';
import { HealthApi } from '../health/data/health.api';
import { DspApi } from './data/dsp.api';
import { NAVIGUER_HORS_APPLICATION } from './naviguer-hors-application';

const BASE = 'http://distante.test/remotes/magelian/main.js';

/** La VRAIE route `systeme` de ROUTES_ADMIN, sous un préfixe d'hôte, sans le garde. */
async function monter(url: string) {
  const systeme = (ROUTES_ADMIN[0].children ?? []).find((r) => r.path === 'systeme') as Route;
  const naviguer = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), HealthApi, FraicheurApi, DspApi, NotificationsService,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      { provide: BASE_RESSOURCES, useValue: BASE },
      { provide: NAVIGUER_HORS_APPLICATION, useValue: naviguer },
      provideRouter([{ path: 'hote/app/admin', children: [systeme] }]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await harness.fixture.whenStable();
  const el = harness.fixture.nativeElement as HTMLElement;
  const barre = (selecteur: string) => [...el.querySelectorAll<HTMLAnchorElement>(`${selecteur} [role="tab"]`)];
  return {
    el, harness, naviguer,
    http: TestBed.inject(HttpTestingController),
    router: TestBed.inject(Router),
    /** Onglets de la PAGE Système (la barre directe du cadre, pas les sous-onglets de l'écran). */
    ongletsPage: () => barre('mg-systeme > div > mg-onglets-routes'),
    sousOnglets: () => barre('mg-connexions-api mg-onglets-routes'),
  };
}

/** Lectures de DV360 au montage, répondues à vide. */
function repondreDv360(http: HttpTestingController) {
  http.expectOne('/api/admin/dsp/connections').flush({ connections: [] });
  http.expectOne('/api/admin/dsp/dv360/config').flush({
    env: { enc_key: true, oauth_client_id: false, oauth_client_secret: false, oauth_redirect_uri: true, redirect_uri_value: 'x' },
    ready: { service_account: true, oauth: false },
  });
  http.expectOne((r) => r.url === '/api/admin/dsp/logs').flush({ logs: [] });
}

describe('ConnexionsApiPage — onglet « Connexions API » de Système (lot 6, T9)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('`systeme/api` mène à `systeme/api/dv360` : onglet Système ET sous-onglet DV360 actifs, cinq sous-onglets de React', async () => {
    const { el, http, router, ongletsPage, sousOnglets } = await monter('/hote/app/admin/systeme/api');
    expect(router.url).toBe('/hote/app/admin/systeme/api/dv360');
    expect(ongletsPage().map((a) => [a.textContent!.trim(), a.getAttribute('aria-selected')])).toEqual([
      ['Santé', 'false'], ['Fraîcheur des données', 'false'], ['Connexions API', 'true'],
    ]);
    expect(sousOnglets().map((a) => a.textContent!.trim())).toEqual(['DV360', 'Meta', 'TikTok', 'The Trade Desk', 'Logs']);
    expect(sousOnglets().map((a) => a.getAttribute('href'))).toEqual(
      ['dv360', 'meta', 'tiktok', 'ttd', 'logs'].map((s) => `/hote/app/admin/systeme/api/${s}`));
    expect(sousOnglets().map((a) => a.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false', 'false']);
    // Un seul titre de page : le h1 de Système. L'écran garde titre et sous-titre en en-tête de section.
    expect([...el.querySelectorAll('h1')].map((h) => h.textContent!.trim())).toEqual(['Système']);
    expect(el.querySelector('mg-connexions-api h2')?.textContent?.trim()).toBe('Connexions API');
    expect(el.querySelector('mg-connexions-api [data-sous-titre]')?.textContent?.trim())
      .toBe('Connecter les plateformes DSP pour le reporting et le custom bidding.');
    expect(el.querySelector('mg-connexions-api mg-onglets-routes [role="tablist"]')?.getAttribute('data-variante')).toBe('ecran');
    expect(el.querySelector('mg-dv360')).not.toBeNull();
    repondreDv360(http);
    http.expectNone('/api/admin/health');
  });

  it('chargement DIRECT sur `systeme/api/meta` : Connexions API ET Meta actifs, texte de ProviderPlaceholder, AUCUN appel', async () => {
    const { el, http, ongletsPage, sousOnglets } = await monter('/hote/app/admin/systeme/api/meta');
    expect(ongletsPage().map((a) => a.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true']);
    expect(sousOnglets().map((a) => a.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false', 'false', 'false']);
    expect(el.querySelector('mg-fournisseur-a-venir [data-titre]')?.textContent?.trim()).toBe('Intégration Meta bientôt disponible');
    expect(el.querySelector('mg-fournisseur-a-venir [data-texte]')?.textContent?.trim())
      .toBe('La connexion Meta sera ajoutée après la mise en production de DV360.');
    const img = el.querySelector<HTMLImageElement>('mg-fournisseur-a-venir img')!;
    // Logo résolu contre l'adresse de la REMOTE (C15), jamais `/logos/…` absolu.
    expect(img.getAttribute('src')).toBe('http://distante.test/remotes/magelian/logos/meta.svg');
    expect(img.getAttribute('alt')).toBe('Meta');
    expect(el.querySelector<HTMLInputElement>('mg-fournisseur-a-venir input')?.disabled).toBe(true);
    http.expectNone(() => true);
  });

  it('The Trade Desk : même écran, libellé complet', async () => {
    const { el, http } = await monter('/hote/app/admin/systeme/api/ttd');
    expect(el.querySelector('mg-fournisseur-a-venir [data-titre]')?.textContent?.trim()).toBe('Intégration The Trade Desk bientôt disponible');
    expect(el.querySelector('mg-fournisseur-a-venir img')?.getAttribute('src')).toBe('http://distante.test/remotes/magelian/logos/ttd.svg');
    http.expectNone(() => true);
  });

  it('TikTok et Logs (T10) : les vrais écrans sous leurs sous-onglets, leurs SEULES lectures au montage', async () => {
    const { el, harness, http, sousOnglets } = await monter('/hote/app/admin/systeme/api/tiktok');
    expect(el.querySelector('mg-tiktok')).not.toBeNull();
    expect(sousOnglets().map((a) => a.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true', 'false', 'false']);
    expect(http.match(() => true).map((r) => r.request.urlWithParams)).toEqual([
      '/api/admin/dsp/connections', '/api/admin/dsp/tiktok/config', '/api/admin/dsp/logs?provider=tiktok&limit=20',
    ]);
    await harness.navigateByUrl('/hote/app/admin/systeme/api/logs');
    expect(el.querySelector('mg-journal-dsp')).not.toBeNull();
    expect(sousOnglets().map((a) => a.getAttribute('aria-selected'))).toEqual(['false', 'false', 'false', 'false', 'true']);
    expect(http.match(() => true).map((r) => r.request.urlWithParams)).toEqual(['/api/admin/dsp/logs']);
  });

  it('flèche droite sur le sous-onglet DV360 : focus sur Meta (activation manuelle), Entrée y navigue, sans toucher la barre de Système', async () => {
    const { http, router, harness, sousOnglets, ongletsPage } = await monter('/hote/app/admin/systeme/api/dv360');
    repondreDv360(http);
    sousOnglets()[0].focus();
    sousOnglets()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await harness.fixture.whenStable();
    expect(router.url).toBe('/hote/app/admin/systeme/api/dv360');
    sousOnglets()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await harness.fixture.whenStable();
    expect(router.url).toBe('/hote/app/admin/systeme/api/meta');
    expect(ongletsPage().map((a) => a.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true']);
  });
});
