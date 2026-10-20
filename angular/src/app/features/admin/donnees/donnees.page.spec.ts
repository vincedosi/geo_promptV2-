import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter, type Route } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ConfigService } from '../../../core/config/config.service';
import { ROUTES_ADMIN } from '../admin.routes';
import { ImportsApi } from '../imports/data/imports.api';
import { IrisCrawlerApi } from '../iris-crawler/data/iris-crawler.api';
import { QualiteApi } from '../qualite-donnees/data/qualite.api';
import { OrganisationsListeApi } from '../commun/data/organisations-liste.api';
import { RadioAdminApi } from '../radio/data/radio-admin.api';
import { SourcesAdminApi } from '../sources/data/sources-admin.api';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { CategoriesPoiApi } from '../commun/data/categories-poi.api';
import { ImportPoiApi } from '../import/data/import-poi.api';
import { ImportGeoApi } from '../carreaux-import/data/import-geo.api';

/** La VRAIE route `donnees` de ROUTES_ADMIN, sous un préfixe d'hôte, sans le garde. */
async function monter(url: string) {
  const donnees = (ROUTES_ADMIN[0].children ?? []).find((r) => r.path === 'donnees') as Route;
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), ImportGeoApi, QualiteApi, ImportsApi, IrisCrawlerApi, SourcesAdminApi, RadioAdminApi, OrganisationsListeApi,
      CategoriesPoiApi, ImportPoiApi, NotificationsService,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      provideRouter([{ path: 'hote/app/admin', children: [donnees] }]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await harness.fixture.whenStable();
  const el = harness.fixture.nativeElement as HTMLElement;
  return { el, http: TestBed.inject(HttpTestingController), router: TestBed.inject(Router) };
}

describe('DonneesPage — page Données à onglets (lot 6, T6)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('/hote/app/admin/donnees/qualite : titre « Données », onglets « Sources », « Importer », « Historique » puis « Qualité » (actif), et l’écran Qualité des données', async () => {
    const url = '/hote/app/admin/donnees/qualite';
    const { el, http, router } = await monter(url);
    expect(router.url).toBe('/hote/app/admin/donnees/qualite');
    expect(el.querySelector('mg-donnees h1')?.textContent?.trim()).toBe('Données');
    const onglets = [...el.querySelectorAll<HTMLAnchorElement>('mg-donnees [role="tab"]')];
    // Pas d'onglet « bientôt » : chacun est arrivé avec son écran (Historique : T11′, Importer : T15, Sources : T18).
    expect(onglets.map((a) => a.textContent!.trim())).toEqual(['Sources', 'Importer', 'Historique', 'Qualité']);
    expect(onglets.map((a) => a.getAttribute('aria-selected'))).toEqual(['false', 'false', 'false', 'true']);
    expect(onglets.map((a) => a.getAttribute('href'))).toEqual([
      '/hote/app/admin/donnees/sources', '/hote/app/admin/donnees/importer', '/hote/app/admin/donnees/historique',
      '/hote/app/admin/donnees/qualite',
    ]);
    expect(el.querySelector('mg-donnees mg-qualite-donnees')).not.toBeNull();
    // Un seul titre de page : celui du cadre. Le titre « Qualité des données » de React est
    // remonté dans le cadre, comme « Santé système » dans Système — plus de double en-tête.
    expect([...el.querySelectorAll('h1')].map((h) => h.textContent!.trim())).toEqual(['Données']);
    // L'écran lit ses relevés à son ouverture, comme React : UN GET.
    http.expectOne('/api/admin/qualite-donnees').flush({ verifications: [] });
  });

  it('/donnees/historique : onglet « Historique » actif, l’écran Historique des imports, UN GET, un seul titre', async () => {
    const { el, http, router } = await monter('/hote/app/admin/donnees/historique');
    expect(router.url).toBe('/hote/app/admin/donnees/historique');
    const onglets = [...el.querySelectorAll<HTMLAnchorElement>('mg-donnees [role="tab"]')];
    expect(onglets.map((a) => a.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true', 'false']);
    expect(el.querySelector('mg-donnees mg-imports')).not.toBeNull();
    expect([...el.querySelectorAll('h1')].map((h) => h.textContent!.trim())).toEqual(['Données']);
    http.expectOne('/api/admin/imports').flush({ success: true, imports: [] });
  });

  it('/hote/app/admin/donnees/importer/iris : onglet « Importer » actif, choix du type (« POI », « Shapefile », « IRIS » actif, « Radio »), l’écran IRIS crawler, AUCUNE requête', async () => {
    const url = '/hote/app/admin/donnees/importer/iris';
    const { el, router } = await monter(url);
    expect(router.url).toBe('/hote/app/admin/donnees/importer/iris');
    const onglets = [...el.querySelectorAll<HTMLAnchorElement>('mg-donnees > div > mg-onglets-routes [role="tab"]')];
    expect(onglets.map((a) => a.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false', 'false']);
    // Le choix du type ne liste que les écrans PORTÉS (A7), jamais « bientôt » : Radio depuis T16, POI (en tête) depuis T12, Shapefile depuis T14.
    const types = [...el.querySelectorAll<HTMLAnchorElement>('mg-importer [role="tab"]')];
    expect(types.map((a) => [a.textContent!.trim(), a.getAttribute('href'), a.getAttribute('aria-selected')])).toEqual([
      ['POI', '/hote/app/admin/donnees/importer/poi', 'false'],
      ['Shapefile', '/hote/app/admin/donnees/importer/shapefile', 'false'],
      ['IRIS', '/hote/app/admin/donnees/importer/iris', 'true'],
      ['Radio', '/hote/app/admin/donnees/importer/radio', 'false'],
    ]);
    expect(el.querySelector('mg-importer mg-iris-crawler')).not.toBeNull();
    expect([...el.querySelectorAll('h1')].map((h) => h.textContent!.trim())).toEqual(['Données']);
    // Rien ne part à l'ouverture : le dépôt attend un fichier (`afterEach` vérifie qu'aucune requête n'est en attente).
  });

  for (const url of ['/hote/app/admin/donnees', '/hote/app/admin/donnees/sources']) {
    it(`${url} : la racine mène à « Sources » (PREMIER onglet, T18), l’écran Sources, ses quatre lectures, un seul titre`, async () => {
      const { el, http, router } = await monter(url);
      expect(router.url).toBe('/hote/app/admin/donnees/sources');
      const onglets = [...el.querySelectorAll<HTMLAnchorElement>('mg-donnees > div > mg-onglets-routes [role="tab"]')];
      expect(onglets.map((a) => a.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false']);
      expect(el.querySelector('mg-donnees mg-sources')).not.toBeNull();
      expect([...el.querySelectorAll('h1')].map((h) => h.textContent!.trim())).toEqual(['Données']);
      http.expectOne('/api/admin/sources').flush({ success: true, sources: [] });
      http.expectOne('/api/admin/sources-stats').flush({ success: false });
      http.expectOne('/api/radio/stats').flush({});
      http.expectOne('/api/admin/custom-geo/stats').flush({});
    });
  }
});
