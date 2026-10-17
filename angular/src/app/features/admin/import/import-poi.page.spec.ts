import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter, type Route } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ConfigService } from '../../../core/config/config.service';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { ROUTES_ADMIN } from '../admin.routes';
import { CategoriesPoiApi } from '../commun/data/categories-poi.api';
import { OrganisationsListeApi } from '../commun/data/organisations-liste.api';
import { ImportsApi } from '../imports/data/imports.api';
import { IrisCrawlerApi } from '../iris-crawler/data/iris-crawler.api';
import { QualiteApi } from '../qualite-donnees/data/qualite.api';
import { RadioAdminApi } from '../radio/data/radio-admin.api';
import { SourcesAdminApi } from '../sources/data/sources-admin.api';
import { ImportPoiApi } from './data/import-poi.api';
import { ANALYSE_POI_ESSAI } from './testing/import-poi.fixture';
import { ESSAI_A_BLANC } from './testing/geocodage.fixture';

const texte = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

/** La VRAIE route `donnees` de ROUTES_ADMIN, sous un préfixe d'hôte, sans le garde. */
async function monter(url: string) {
  const donnees = (ROUTES_ADMIN[0].children ?? []).find((r) => r.path === 'donnees') as Route;
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), QualiteApi, ImportsApi, IrisCrawlerApi, SourcesAdminApi, RadioAdminApi,
      OrganisationsListeApi, CategoriesPoiApi, ImportPoiApi, NotificationsService,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      provideRouter([{ path: 'hote/app/admin', children: [donnees] }]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await harness.fixture.whenStable();
  return {
    harness, el: harness.fixture.nativeElement as HTMLElement,
    http: TestBed.inject(HttpTestingController), router: TestBed.inject(Router),
  };
}

function lecturesDuMontage(http: HttpTestingController): void {
  http.expectOne('/api/admin/organizations').flush({ success: true, organizations: [{ id: 'o1', name: 'Espace A' }] });
  http.expectOne('/api/admin/poi-categories').flush({ success: true, categories: [{ categorie: 'lycee', label_fr: 'Tous les lycées', icone: '🎓' }] });
}

function deposer(el: HTMLElement, fichier: File): void {
  const e = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: { files: [fichier], dropEffect: 'none' } });
  el.querySelector('mg-import-depot [data-zone]')!.dispatchEvent(e);
}

describe('ImportPoiPage — `admin/donnees/importer/poi` (`app/admin/import/page.tsx`, lot 6, T12)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  for (const url of ['/hote/app/admin/donnees/importer', '/hote/app/admin/donnees/importer/poi']) {
    it(`${url} : « POI » en tête du choix du type et actif, badge « Admin », sous-titre et pied de React, étape 01 seule, UN GET organisations et UN GET catégories`, async () => {
      const { el, http, router } = await monter(url);
      expect(router.url).toBe('/hote/app/admin/donnees/importer/poi');
      const types = [...el.querySelectorAll<HTMLAnchorElement>('mg-importer [role="tab"]')];
      expect(types.map((a) => [texte(a), a.getAttribute('href'), a.getAttribute('aria-selected')])).toEqual([
        ['POI', '/hote/app/admin/donnees/importer/poi', 'true'],
        ['IRIS', '/hote/app/admin/donnees/importer/iris', 'false'],
        ['Radio', '/hote/app/admin/donnees/importer/radio', 'false'],
      ]);
      const page = el.querySelector('mg-import-poi')!;
      expect([...page.querySelectorAll('[data-badge]')].map((b) => texte(b))).toEqual(['Admin']);
      expect(texte(page.querySelector('[data-sous-titre]'))).toBe('Import Points d\'interet (POI)');
      expect(texte(page.querySelector('[data-pied]'))).toBe(
        '// Formats supportes: CSV, Excel (.xlsx), GeoJSON · Encodages: UTF-8, Latin-1 (auto-detecte)',
      );
      // Un seul titre de page : celui du cadre « Données » (le `h1` « Import POI » de React y est remonté).
      expect([...el.querySelectorAll('h1')].map((h) => texte(h))).toEqual(['Données']);
      expect(page.querySelector('mg-import-depot')).not.toBeNull();
      for (const s of ['mg-import-categorie', 'mg-import-correspondance', 'mg-import-colonnes']) expect(page.querySelector(s)).toBeNull();
      lecturesDuMontage(http);
    });
  }

  it('déroulé : analyse → « Parsé » et 02 ; catégorie → 03 et 03b ; géolocalisation incomplète → 03b masquée', async () => {
    const { harness, el, http } = await monter('/hote/app/admin/donnees/importer/poi');
    lecturesDuMontage(http);
    deposer(el, new File(['x'], 'poi-essai.csv'));
    http.expectOne('/api/admin/import-poi/parse').flush(ANALYSE_POI_ESSAI);
    await harness.fixture.whenStable();
    const page = el.querySelector('mg-import-poi')!;
    expect([...page.querySelectorAll('[data-badge]')].map((b) => texte(b))).toEqual(['Admin', 'Parsé']);
    expect(page.querySelector('mg-import-categorie')).not.toBeNull();
    expect(page.querySelector('mg-import-correspondance')).toBeNull();
    const select = page.querySelector<HTMLSelectElement>('mg-import-categorie select')!;
    select.value = 'lycee';
    select.dispatchEvent(new Event('change'));
    await harness.fixture.whenStable();
    expect(page.querySelector('mg-import-correspondance')).not.toBeNull();
    expect(page.querySelector('mg-import-colonnes')).not.toBeNull();
    const lat = page.querySelector<HTMLSelectElement>('mg-import-correspondance [data-geo-champs] select')!;
    lat.value = '';
    lat.dispatchEvent(new Event('change'));
    await harness.fixture.whenStable();
    expect(page.querySelector('mg-import-colonnes')).toBeNull();
  });

  it('T13 — GPS : 04 « Test (dry-run) » sous 03b, sans 03c ; essai réussi → 05 ; mode adresse : 03c, et 04 attend la validation', async () => {
    const { harness, el, http } = await monter('/hote/app/admin/donnees/importer/poi');
    lecturesDuMontage(http);
    deposer(el, new File(['x'], 'poi-essai.csv'));
    http.expectOne('/api/admin/import-poi/parse').flush(ANALYSE_POI_ESSAI);
    await harness.fixture.whenStable();
    const page = el.querySelector('mg-import-poi')!;
    const select = page.querySelector<HTMLSelectElement>('mg-import-categorie select')!;
    select.value = 'lycee';
    select.dispatchEvent(new Event('change'));
    await harness.fixture.whenStable();
    const ordre = () => [...page.querySelectorAll('.etapes > *')].map((e) => e.tagName.toLowerCase());
    expect(ordre()).toEqual(['mg-import-depot', 'mg-import-categorie', 'mg-import-correspondance', 'mg-import-colonnes', 'mg-import-essai', 'div']);
    page.querySelector<HTMLButtonElement>('mg-import-essai [data-essayer]')!.click();
    http.expectOne('/api/admin/import-poi/dry-run').flush(ESSAI_A_BLANC);
    await harness.fixture.whenStable();
    expect(ordre()).toContain('mg-import-reel');

    page.querySelector<HTMLInputElement>('mg-import-correspondance input[type="radio"][value="address"]')!.click();
    await harness.fixture.whenStable();
    expect(ordre()).toEqual([
      'mg-import-depot', 'mg-import-categorie', 'mg-import-correspondance', 'mg-import-colonnes', 'mg-import-geocodage', 'mg-import-reel', 'div',
    ]);
  });

  it('l’état vit avec la page : quitter puis revenir repart vide et relit (comme le montage de React)', async () => {
    const { harness, el, http, router } = await monter('/hote/app/admin/donnees/importer/poi');
    lecturesDuMontage(http);
    deposer(el, new File(['x'], 'poi-essai.csv'));
    http.expectOne('/api/admin/import-poi/parse').flush(ANALYSE_POI_ESSAI);
    await router.navigateByUrl('/hote/app/admin/donnees/importer/iris');
    await router.navigateByUrl('/hote/app/admin/donnees/importer/poi');
    await harness.fixture.whenStable();
    lecturesDuMontage(http);
    expect(el.querySelector('mg-import-categorie')).toBeNull();
    expect(texte(el.querySelector('mg-import-depot [data-zone]'))).toContain('Glissez un ou plusieurs fichiers');
  });
});
