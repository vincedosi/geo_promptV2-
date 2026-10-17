import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { formaterNombre } from '../../../../core/format/nombre';
import { NotificationsService } from '../../../../ui/notifications/notifications.service';
import { CategoriesPoiApi } from '../../commun/data/categories-poi.api';
import { OrganisationsListeApi } from '../../commun/data/organisations-liste.api';
import { ImportPoiApi } from '../data/import-poi.api';
import { ImportPoiService } from '../etat/import-poi.service';
import { ESSAI_A_BLANC } from '../testing/geocodage.fixture';
import { ANALYSE_POI_ESSAI } from '../testing/import-poi.fixture';
import { EssaiComponent } from './essai.component';

const texte = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
/** Angular retire les blancs entre éléments : les enfants se lisent un à un. */
const enfants = (e: Element) => [...e.children].map((c) => texte(c)).join(' ');
const espaces = (s: string) => s.replace(/\s/g, ' ');
const URL_ESSAI = '/api/admin/import-poi/dry-run';

async function monter() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), ImportPoiApi, CategoriesPoiApi, OrganisationsListeApi,
      NotificationsService, ImportPoiService,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  const etat = TestBed.inject(ImportPoiService);
  const http = TestBed.inject(HttpTestingController);
  etat.analyser([new File(['x'], 'poi-essai.csv')]);
  http.expectOne('/api/admin/import-poi/parse').flush(ANALYSE_POI_ESSAI);
  etat.choisirCategorie('essai_lot_6');
  const f = TestBed.createComponent(EssaiComponent);
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const stable = () => f.whenStable();
  const bouton = () => el.querySelector<HTMLButtonElement>('[data-essayer]')!;
  return { f, el, etat, http, stable, bouton };
}

describe('mg-import-essai — étape 04 « Test (dry-run) » (`DryRunStep.tsx`, lot 6, T13)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('« > Tester (100 lignes) » → POST du corps exact ; « Test en cours... » désactivé pendant l’appel', async () => {
    const { el, etat, http, stable, bouton } = await monter();
    expect(texte(el.querySelector('[data-num]'))).toBe('04');
    expect(texte(el.querySelector('[data-titre]'))).toBe('Test (dry-run)');
    expect(texte(bouton())).toBe('> Tester (100 lignes)');
    bouton().click();
    await stable();
    expect(texte(bouton())).toBe('Test en cours...');
    expect(bouton().disabled).toBe(true);
    const req = http.expectOne(URL_ESSAI);
    expect(req.request.body).toEqual({
      fileId: ANALYSE_POI_ESSAI.fileId, dataType: 'poi', category: 'essai_lot_6', mapping: etat.correspondance(),
      geolocation: { mode: 'gps', colLat: 'latitude', colLng: 'longitude' }, limit: 100,
    });
    req.flush(ESSAI_A_BLANC);
    await stable();
    expect(bouton().disabled).toBe(false);
  });

  it('résultat : badge « 9 valides », tuiles Valides / Sans coords / Exclus, échantillon (JSON indenté) et erreurs repliés', async () => {
    const { el, http, stable, bouton } = await monter();
    bouton().click();
    await stable();
    http.expectOne(URL_ESSAI).flush(ESSAI_A_BLANC);
    await stable();
    expect(texte(el.querySelector('[data-valides]'))).toBe('9 valides');
    expect([...el.querySelectorAll('[data-tuiles] > div')].map((t) => enfants(t))).toEqual(['Valides 9', 'Sans coords 1', 'Exclus 0']);
    expect(el.querySelector('[data-tuiles-geocodage]')).toBeNull();
    const echantillon = el.querySelector<HTMLDetailsElement>('[data-echantillon]')!;
    expect(echantillon.open).toBe(false);
    expect(texte(echantillon.querySelector('summary'))).toBe('Points d\'apercu (2)');
    expect(echantillon.querySelector('pre')!.textContent).toBe(JSON.stringify(ESSAI_A_BLANC.samplePoints, null, 2));
    const erreurs = el.querySelector<HTMLDetailsElement>('[data-erreurs]')!;
    expect(texte(erreurs.querySelector('summary'))).toBe('Erreurs (1)');
    expect(erreurs.querySelector('pre')!.textContent).toBe('Ligne 7: [coords] Coordonnees manquantes');
    expect(el.querySelector('[data-erreur]')).toBeNull();
  });

  it('géocodage dans l’essai : seconde rangée Geocodes / Echecs geocodage / Total fichier (`toLocaleString`)', async () => {
    const { el, http, stable, bouton } = await monter();
    bouton().click();
    await stable();
    http.expectOne(URL_ESSAI).flush({ ...ESSAI_A_BLANC, stats: { ...ESSAI_A_BLANC.stats, geocodedRows: 8, geocodeErrors: 2 }, errors: [], samplePoints: [] });
    await stable();
    expect([...el.querySelectorAll('[data-tuiles-geocodage] > div')].map((t) => espaces(enfants(t)))).toEqual([
      'Geocodes 8', 'Echecs geocodage 2', espaces(`Total fichier ${formaterNombre(1234)}`),
    ]);
    expect(el.querySelector('[data-echantillon]')).toBeNull();
    expect(el.querySelector('[data-erreurs]')).toBeNull();
  });

  it('refus : « ! <error> » (ex. `geocodeId invalide` de la route), aucune tuile', async () => {
    const { el, http, stable, bouton } = await monter();
    bouton().click();
    await stable();
    http.expectOne(URL_ESSAI).flush({ success: false, error: 'geocodeId invalide' }, { status: 400, statusText: 'Bad Request' });
    await stable();
    expect(texte(el.querySelector('[data-erreur]'))).toBe('! geocodeId invalide');
    expect(el.querySelector('[data-tuiles]')).toBeNull();
    expect(el.querySelector('[data-valides]')).toBeNull();
  });
});
