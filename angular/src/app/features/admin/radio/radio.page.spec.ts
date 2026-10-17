import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter, type Route } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ConfigService } from '../../../core/config/config.service';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { ROUTES_ADMIN } from '../admin.routes';
import { IrisCrawlerApi } from '../iris-crawler/data/iris-crawler.api';
import { RadioAdminApi } from './data/radio-admin.api';
import { HISTORIQUE_RADIO, STATS_RADIO } from './testing/radio-donnees.fixture';

const texte = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

/** La VRAIE route `donnees` de ROUTES_ADMIN, sous un préfixe d'hôte, sans le garde. */
async function monter(url: string) {
  const donnees = (ROUTES_ADMIN[0].children ?? []).find((r) => r.path === 'donnees') as Route;
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), RadioAdminApi, IrisCrawlerApi, NotificationsService,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      provideRouter([{ path: 'hote/app/admin', children: [donnees] }]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await harness.fixture.whenStable();
  return {
    el: harness.fixture.nativeElement as HTMLElement,
    http: TestBed.inject(HttpTestingController),
    router: TestBed.inject(Router),
  };
}

describe('RadioPage — écran Radio, type « Radio » de Données › Importer (lot 6, T16, amendement A7)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  for (const url of ['/hote/app/admin/donnees/importer/radio', '/hote/app/admin/donnees/importer/radio/import']) {
    it(`${url} : onglet Import actif, badge « Admin » et sous-titre de React, aucun titre de plus que « Données »`, async () => {
      const { el, http, router } = await monter(url);
      expect(router.url).toBe('/hote/app/admin/donnees/importer/radio/import');
      // Le choix du type liste IRIS puis Radio (A7 : seuls les écrans portés), Radio actif.
      const types = [...el.querySelectorAll<HTMLAnchorElement>('mg-importer > mg-onglets-routes [role="tab"]')];
      expect(types.map((a) => [texte(a), a.getAttribute('href'), a.getAttribute('aria-selected')])).toEqual([
        ['IRIS', '/hote/app/admin/donnees/importer/iris', 'false'],
        ['Radio', '/hote/app/admin/donnees/importer/radio', 'true'],
      ]);
      const radio = el.querySelector('mg-radio')!;
      expect(texte(radio.querySelector('[data-badge]'))).toBe('Admin');
      expect(texte(radio.querySelector('[data-sous-titre]'))).toBe('Import, classification, audience et tarifs des émetteurs radio');
      // Le titre « Radio FM/DAB+ » de React est porté par le cadre (Données › Importer › Radio).
      expect([...el.querySelectorAll('h1')].map((h) => texte(h))).toEqual(['Données']);
      // Onglets propres à l'écran (`page.tsx:356-366`) : seuls les PORTÉS — Import (T16) ; Radios et
      // Statistiques arrivent en T17.
      const onglets = [...radio.querySelectorAll<HTMLAnchorElement>('mg-onglets-routes [role="tab"]')];
      expect(onglets.map((a) => [texte(a), a.getAttribute('href'), a.getAttribute('aria-selected')])).toEqual([
        ['Import', '/hote/app/admin/donnees/importer/radio/import', 'true'],
      ]);
      expect(radio.querySelector('mg-radio-import')).not.toBeNull();
      http.expectOne('/api/radio/stats').flush(STATS_RADIO);
      http.expectOne('/api/radio/imports-history').flush({ imports: HISTORIQUE_RADIO });
    });
  }

  it('au montage : DEUX lectures, comme React (`useEffect(() => { fetchStats(); fetchImports(); })`) — rien des onglets Radios / Statistiques', async () => {
    const { http } = await monter('/hote/app/admin/donnees/importer/radio');
    const stats = http.expectOne('/api/radio/stats');
    const historique = http.expectOne('/api/radio/imports-history');
    expect(stats.request.method).toBe('GET');
    expect(historique.request.method).toBe('GET');
    http.expectNone((r) => r.url.includes('/radio/stations') || r.url.includes('/radio/audit'));
    stats.flush(STATS_RADIO);
    historique.flush({ imports: HISTORIQUE_RADIO });
  });

  it('quitter l’écran pendant les lectures les annule (lectures seules, C13)', async () => {
    const { http, router } = await monter('/hote/app/admin/donnees/importer/radio');
    const stats = http.expectOne('/api/radio/stats');
    const historique = http.expectOne('/api/radio/imports-history');
    await router.navigateByUrl('/hote/app/admin/donnees/importer/iris');
    expect(stats.cancelled).toBe(true);
    expect(historique.cancelled).toBe(true);
  });
});
