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
import { ImportsApi } from '../imports/data/imports.api';
import { IrisCrawlerApi } from '../iris-crawler/data/iris-crawler.api';
import { deposer, texte } from './testing/aides';
import { fichiersEssai } from './testing/shapefile.fixture';
import { doublerDialog } from '../testing/dom';

/** La VRAIE route `donnees` de ROUTES_ADMIN, sous un préfixe d'hôte, sans le garde. */
async function monter(url: string) {
  const donnees = (ROUTES_ADMIN[0].children ?? []).find((r) => r.path === 'donnees') as Route;
  const chargeur = vi.fn(chargerProj4);
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), ImportGeoApi, ImportsApi, IrisCrawlerApi, NotificationsService,
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

/**
 * Attend le passage automatique au mapping (lecture réelle du bundle). `vi.waitFor` plutôt qu'une boucle de 5 s :
 * sous la charge de la suite complète, la lecture et sa minuterie de 600 ms dépassaient la boucle (vague finale, J1).
 */
async function jusquAuMapping(harness: RouterTestingHarness, el: HTMLElement): Promise<void> {
  await vi.waitFor(async () => {
    await harness.fixture.whenStable();
    expect(el.querySelector('mg-shapefile-correspondance')).not.toBeNull();
  }, { timeout: 15_000, interval: 50 });
}

/** Dépôt du bundle jetable, mapping, puis « Lancer l'insertion » : le premier lot est EN VOL. */
async function lancerEnvoi(harness: RouterTestingHarness, el: HTMLElement, http: HttpTestingController, n = 1500) {
  deposer(el, fichiersEssai(n));
  await jusquAuMapping(harness, el);
  el.querySelector<HTMLButtonElement>('mg-shapefile-correspondance button.lancer')!.click();
  await harness.fixture.whenStable();
  el.querySelector<HTMLButtonElement>('mg-shapefile-envoi button.lancer')!.click();
  await harness.fixture.whenStable();
  return http.expectOne(URL_LOT);
}

/** Laisse courir les promesses (garde, chargement paresseux) puis rend la vue, sans attendre la navigation. */
async function rendre(harness: RouterTestingHarness): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 10));
  harness.fixture.detectChanges();
}

const URL_LOT = '/api/admin/import-geo';
const URL_REGISTER = '/api/admin/import-geo/register';

describe('CarreauxImportPage — `admin/donnees/importer/shapefile` (`app/admin/carreaux-import/page.tsx`, lot 6, T14)', { timeout: 30_000 }, () => {
  // `proj4` chargé UNE fois avant la suite (J1) : son premier `import()` coûtait plusieurs secondes sous charge.
  beforeAll(async () => {
    await chargerProj4();
  }, 30_000);
  beforeEach(() => doublerDialog());
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
    await jusquAuMapping(harness, el);
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

  it('I-2 / Q-2 : l’envoi SURVIT au passage par un autre type d’import — retour sur Shapefile, envoi en cours, aucun lot perdu, `register` final', async () => {
    const { harness, el, http, router } = await monter('/hote/app/admin/donnees/importer/shapefile');
    const lot1 = await lancerEnvoi(harness, el, http);
    await router.navigateByUrl('/hote/app/admin/donnees/importer/iris');
    await harness.fixture.whenStable();
    // Aucune confirmation : on reste dans « Importer », l'état de l'import vit au niveau de la page Importer.
    expect(router.url).toBe('/hote/app/admin/donnees/importer/iris');
    expect(lot1.cancelled).toBe(false);
    lot1.flush({ success: true, inserted: 1000 });
    await harness.fixture.whenStable();
    await vi.waitFor(() => http.expectOne(URL_LOT).flush({ success: true, inserted: 500 }), { timeout: 2_000, interval: 10 });
    await router.navigateByUrl('/hote/app/admin/donnees/importer/shapefile');
    await harness.fixture.whenStable();
    expect(el.querySelector('mg-shapefile-envoi')).not.toBeNull();
    const enregistrement = await vi.waitFor(() => http.expectOne(URL_REGISTER), { timeout: 2_000, interval: 10 });
    expect(enregistrement.request.body.row_count).toBe(1500);
    enregistrement.flush({ success: true, source_id: 'jetable' });
    await vi.waitFor(async () => {
      await harness.fixture.whenStable();
      expect(texte(el.querySelector('mg-shapefile-envoi [data-envoi]'))).toContain('✓ Import terminé');
    }, { timeout: 2_000, interval: 10 });
  });

  it('I-2 / Q-2 : quitter « Importer » pendant l’envoi demande confirmation ; « Rester » garde la page, « Quitter l’import » part', async () => {
    const { harness, el, http, router } = await monter('/hote/app/admin/donnees/importer/shapefile');
    const lot1 = await lancerEnvoi(harness, el, http);
    const navigation = router.navigateByUrl('/hote/app/admin/donnees/historique');
    // Pas de `whenStable` : la navigation, suspendue à la confirmation, est une tâche en attente.
    await rendre(harness);
    const confirmation = el.querySelector('mg-importer mg-confirmation[data-confirmation-sortie]')!;
    expect(confirmation.querySelector('dialog')!.hasAttribute('open')).toBe(true);
    expect(texte(confirmation)).toContain('Un import Shapefile est en cours (0 / 2 lots).');
    expect(texte(confirmation)).toContain('les lots déjà envoyés resteront en base sans source enregistrée');
    confirmation.querySelector<HTMLButtonElement>('button.annuler')!.click();
    expect(await navigation).toBe(false);
    await harness.fixture.whenStable();
    expect(router.url).toBe('/hote/app/admin/donnees/importer/shapefile');
    expect(confirmation.querySelector('dialog')!.hasAttribute('open')).toBe(false);

    const seconde = router.navigateByUrl('/hote/app/admin/donnees/historique');
    await rendre(harness);
    el.querySelector<HTMLButtonElement>('mg-importer mg-confirmation[data-confirmation-sortie] button.confirmer')!.click();
    expect(await seconde).toBe(true);
    expect(router.url).toBe('/hote/app/admin/donnees/historique');
    // L'historique lit sa liste ; le lot en vol se termine sans suite (aucun lot nouveau, aucun `register`).
    http.match((r) => r.url !== URL_LOT).forEach((r) => r.flush({ imports: [] }));
    lot1.flush({ success: true, inserted: 1000 });
    await harness.fixture.whenStable();
    http.expectNone(URL_LOT);
    http.expectNone(URL_REGISTER);
  });

  it('quitter pendant l’« Enregistrement » : le message dit que les lots sont envoyés et la déclaration partie (revue des vagues, Minor 3)', async () => {
    const { harness, el, http, router } = await monter('/hote/app/admin/donnees/importer/shapefile');
    const lot1 = await lancerEnvoi(harness, el, http);
    lot1.flush({ success: true, inserted: 1000 });
    await vi.waitFor(() => http.expectOne(URL_LOT).flush({ success: true, inserted: 500 }), { timeout: 2_000, interval: 10 });
    const enregistrement = await vi.waitFor(() => http.expectOne(URL_REGISTER), { timeout: 2_000, interval: 10 });
    const navigation = router.navigateByUrl('/hote/app/admin/donnees/historique');
    await rendre(harness);
    const confirmation = el.querySelector('mg-importer mg-confirmation[data-confirmation-sortie]')!;
    expect(confirmation.querySelector('dialog')!.hasAttribute('open')).toBe(true);
    expect(texte(confirmation)).toContain('tous les lots sont envoyés et la déclaration est déjà partie');
    expect(texte(confirmation)).not.toContain('sans source enregistrée');
    confirmation.querySelector<HTMLButtonElement>('button.annuler')!.click();
    expect(await navigation).toBe(false);
    enregistrement.flush({ success: true, source_id: 'jetable' });
    await vi.waitFor(async () => {
      await harness.fixture.whenStable();
      expect(texte(el.querySelector('mg-shapefile-envoi [data-envoi]'))).toContain('✓ Import terminé');
    }, { timeout: 2_000, interval: 10 });
  });

  it('sans envoi en cours, quitter « Importer » ne demande rien', async () => {
    const { harness, el, router, http } = await monter('/hote/app/admin/donnees/importer/shapefile');
    expect(await router.navigateByUrl('/hote/app/admin/donnees/historique')).toBe(true);
    await harness.fixture.whenStable();
    http.match(() => true).forEach((r) => r.flush({ imports: [] }));
    expect(el.querySelector('mg-confirmation[data-confirmation-sortie] dialog[open]')).toBeNull();
  });
});
