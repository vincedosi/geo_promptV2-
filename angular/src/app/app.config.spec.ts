import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { appConfig } from './app.config';
import { SUPABASE } from './core/auth/supabase';
import { ConfigService } from './core/config/config.service';
import { BASE_RESSOURCES } from './core/ressources/ressource-distante';

/**
 * Couvre le VRAI graphe de providers d'appConfig ET de la route — les specs
 * unitaires de ConfigService et jetonInterceptor mockent chacune l'autre bout
 * de la dépendance circulaire (config -> intercepteur -> HttpBaseService ->
 * ConfigService.valeur) et ne l'auraient donc jamais attrapée, pas plus qu'un
 * inject() après await (NG0203). Le démarrage ne vit plus dans un
 * APP_INITIALIZER mais dans la route racine de `remoteRoutes` (le shell AIDA
 * n'exécute pas app.config.ts) : ce test lance donc l'application comme
 * bootstrap.ts puis navigue sur `/`, sans rien mocker du côté config/HTTP —
 * seul le client Supabase est remplacé.
 */
function fauxSupabase() {
  const session = { access_token: 'jeton-demarrage', user: { email: 'a@exemple.test' } };
  return {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  };
}

const attendre = () => new Promise((r) => setTimeout(r, 0));

/** Base où l'application est servie — distincte du document, comme dans le shell. */
const BASE = 'https://distante.exemple/remotes/magelian/chunk-ABC.js';
const URL_CONFIG = 'https://distante.exemple/remotes/magelian/config.local.json';

/** jsdom ne charge pas les feuilles : on joue le `load` de la feuille globale. */
async function feuilleGlobaleChargee(): Promise<void> {
  const lien = document.head.querySelector('link[data-mg-styles]');
  expect(lien?.getAttribute('href')).toBe('https://distante.exemple/remotes/magelian/magelian.css');
  lien!.dispatchEvent(new Event('load'));
  await attendre();
}

describe('appConfig — démarrage réel, lancement autonome', () => {
  afterEach(() => document.head.querySelector('link[data-mg-styles]')?.remove());

  it('`/` mène à `/app`, la configuration étant chargée PAR LA ROUTE (sans Bearer), puis l\'API reçoit le Bearer', async () => {
    TestBed.configureTestingModule({
      providers: [...appConfig.providers, provideHttpClientTesting(), { provide: SUPABASE, useValue: fauxSupabase() }, { provide: BASE_RESSOURCES, useValue: BASE }],
    });
    const http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();

    // Aucune requête avant la première navigation : plus d'APP_INITIALIZER.
    http.expectNone(URL_CONFIG);

    const navigation = harness.navigateByUrl('/');
    await attendre();
    // La configuration ne part qu'une fois la page stylée.
    http.expectNone(URL_CONFIG);
    await feuilleGlobaleChargee();
    const requete = http.expectOne(URL_CONFIG);
    expect(requete.request.headers.has('Authorization')).toBe(false);
    requete.flush({ supabaseUrl: 'http://127.0.0.1:54321', supabaseAnonKey: 'cle-de-test', apiBaseUrl: '' });
    await navigation;
    await attendre();

    expect(TestBed.inject(Router).url).toBe('/app');
    expect(TestBed.inject(ConfigService).valeur.supabaseUrl).toBe('http://127.0.0.1:54321');
    const api = http.expectOne('/api/risques/sites/compter');
    expect(api.request.headers.get('Authorization')).toBe('Bearer jeton-demarrage');
    api.flush({ retenus: 1, total: 1, par_nature: {} });
  });

  it('une ancienne adresse (`/catalogue`) retombe dans l\'application via `**` → `app`', async () => {
    TestBed.configureTestingModule({
      providers: [...appConfig.providers, provideHttpClientTesting(), { provide: SUPABASE, useValue: fauxSupabase() }, { provide: BASE_RESSOURCES, useValue: BASE }],
    });
    const http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    const navigation = harness.navigateByUrl('/catalogue');
    await attendre();
    await feuilleGlobaleChargee();
    http.expectOne(URL_CONFIG).flush({ supabaseUrl: 'http://x', supabaseAnonKey: 'k', apiBaseUrl: '' });
    await navigation;
    await attendre();
    expect(TestBed.inject(Router).url).toBe('/app');
    http.match(() => true).forEach((r) => r.flush({ retenus: 1, total: 1, par_nature: {} }));
  });
});
