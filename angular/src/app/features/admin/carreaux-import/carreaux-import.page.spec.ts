import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter, type Route } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ConfigService } from '../../../core/config/config.service';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { ROUTES_ADMIN } from '../admin.routes';
import { CHARGEUR_PROJ4, chargerProj4 } from './logique/charger-proj4';
import { ImportGeoApi } from './data/import-geo.api';
import { deposer, texte } from './testing/aides';
import { fichiersEssai } from './testing/shapefile.fixture';

/** La VRAIE route `donnees` de ROUTES_ADMIN, sous un préfixe d'hôte, sans le garde. */
async function monter(url: string) {
  const donnees = (ROUTES_ADMIN[0].children ?? []).find((r) => r.path === 'donnees') as Route;
  const chargeur = vi.fn(chargerProj4);
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), ImportGeoApi, NotificationsService,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      { provide: CHARGEUR_PROJ4, useValue: chargeur },
      provideRouter([{ path: 'hote/app/admin', children: [donnees] }]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await harness.fixture.whenStable();
  return {
    harness, chargeur, el: harness.fixture.nativeElement as HTMLElement,
    http: TestBed.inject(HttpTestingController), router: TestBed.inject(Router),
  };
}

describe('CarreauxImportPage — `admin/donnees/importer/shapefile` (`app/admin/carreaux-import/page.tsx`, lot 6, T14)', { timeout: 20_000 }, () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('« Shapefile » actif dans le choix du type ; sous-titre de React, étape 1 seule, AUCUNE requête, proj4 NON chargé', async () => {
    const { el, router, chargeur } = await monter('/hote/app/admin/donnees/importer/shapefile');
    expect(router.url).toBe('/hote/app/admin/donnees/importer/shapefile');
    const types = [...el.querySelectorAll<HTMLAnchorElement>('mg-importer [role="tab"]')];
    expect(types.map((a) => [texte(a), a.getAttribute('href'), a.getAttribute('aria-selected')])).toEqual([
      ['POI', '/hote/app/admin/donnees/importer/poi', 'false'],
      ['Shapefile', '/hote/app/admin/donnees/importer/shapefile', 'true'],
      ['IRIS', '/hote/app/admin/donnees/importer/iris', 'false'],
      ['Radio', '/hote/app/admin/donnees/importer/radio', 'false'],
    ]);
    const page = el.querySelector('mg-import-shapefile')!;
    expect(texte(page.querySelector('.sous-titre'))).toBe('Import de données géographiques — Shapefile → Supabase');
    expect(page.querySelector('mg-shapefile-etapes')).not.toBeNull();
    expect(page.querySelector('mg-shapefile-fichiers')).not.toBeNull();
    expect(page.querySelector('mg-shapefile-correspondance, mg-shapefile-envoi')).toBeNull();
    // Le titre « Import shapefile » de React est porté par le cadre (Données › Importer › Shapefile).
    expect([...el.querySelectorAll('h1')].map((h) => texte(h))).toEqual(['Données']);
    expect(chargeur).not.toHaveBeenCalled();
  });

  it('parcours : dépôt → passage automatique au mapping → « Lancer l’import » → étape 3 ; le fil d’étapes ramène en arrière', async () => {
    const { harness, el, chargeur } = await monter('/hote/app/admin/donnees/importer/shapefile');
    deposer(el, fichiersEssai(50));
    // Lecture réelle, puis passage automatique au mapping 600 ms après la fin.
    for (let i = 0; i < 100 && !el.querySelector('mg-shapefile-correspondance'); i++) {
      await new Promise((r) => setTimeout(r, 50));
      await harness.fixture.whenStable();
    }
    expect(chargeur).toHaveBeenCalledTimes(1);
    expect(el.querySelector('mg-shapefile-correspondance')).not.toBeNull();
    el.querySelector<HTMLButtonElement>('mg-shapefile-correspondance button.lancer')!.click();
    await harness.fixture.whenStable();
    expect(el.querySelector('mg-shapefile-envoi')).not.toBeNull();
    expect(texte(el.querySelector('mg-shapefile-envoi button.lancer'))).toBe('Lancer l\'insertion (50 features)');
    el.querySelector<HTMLButtonElement>('mg-shapefile-etapes button[data-etape="1"]')!.click();
    await harness.fixture.whenStable();
    expect(texte(el.querySelector('mg-shapefile-fichiers [data-detail]'))).toBe('50 features · 4 colonnes · CRS: EPSG:2154');
  });

  it('`admin/carreaux-import` (adresse de React) mène à l’écran, RELATIVEMENT', async () => {
    const donnees = (ROUTES_ADMIN[0].children ?? []).find((r) => r.path === 'donnees') as Route;
    const redirection = (ROUTES_ADMIN[0].children ?? []).find((r) => r.path === 'carreaux-import') as Route;
    expect(redirection.redirectTo).toBe('donnees/importer/shapefile');
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), ImportGeoApi, NotificationsService,
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
        provideRouter([{ path: 'hote/app/admin', children: [donnees, redirection] }]),
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/hote/app/admin/carreaux-import');
    expect(TestBed.inject(Router).url).toBe('/hote/app/admin/donnees/importer/shapefile');
    expect((harness.fixture.nativeElement as HTMLElement).querySelector('mg-import-shapefile')).not.toBeNull();
  });
});
