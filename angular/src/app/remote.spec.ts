import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { computed, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationStart, Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { remoteRoutes } from './app.routes';
import { AuthService } from './core/auth/auth.service';
import { BASE_RESSOURCES } from './core/ressources/ressource-distante';
import { feuillesFactices, ombre, policesChargees, retirerPolices } from './core/ressources/testing/feuilles-factices';
import { SitesRisqueApi } from './features/risques/data/sites-risque.api';

/** L'application distante est servie AILLEURS que le document de l'hôte. */
const BASE = 'https://distante.exemple/remotes/magelian/chunk-ABC.js';

/**
 * Le shell AIDA ne charge QUE `remoteRoutes` (doc §4.4-4.5) : ni app.config.ts,
 * ni index.html, ni APP_INITIALIZER. Cet hôte simulé fournit ce qu'un shell
 * fournit a priori — un routeur, un HttpClient SANS nos intercepteurs — et
 * monte l'application sous un préfixe qu'elle ne connaît pas.
 */
const SESSION_FACTICE = { access_token: 'jeton-test', user: { email: 'test@exemple.fr' } };

/** Une session factice qu'un test peut faire apparaître ou disparaître. */
function authFactice(connecte: boolean) {
  const session = signal<typeof SESSION_FACTICE | null>(connecte ? SESSION_FACTICE : null);
  return {
    session,
    connecte: computed(() => session() !== null),
    email: computed(() => session()?.user.email ?? null),
    jeton: async () => session()?.access_token ?? null,
    initialiser: vi.fn(async () => undefined),
    // Comme le vrai : une fin de session, même locale, met la session à null.
    deconnecter: vi.fn(async (_portee?: string) => session.set(null)),
  };
}

function hote(connecte = true) {
  const auth = authFactice(connecte);
  const feuilles = feuillesFactices();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([{ path: 'hote/magelian', children: remoteRoutes }]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: auth },
      { provide: BASE_RESSOURCES, useValue: BASE },
      ...feuilles.providers,
    ],
  });
  return { auth, feuilles, http: TestBed.inject(HttpTestingController) };
}

const attendre = () => new Promise((r) => setTimeout(r, 0));

/** Monte l'application sous le préfixe de l'hôte ; la configuration est servie par l'hôte factice. */
async function monter(connecte = true) {
  const ctx = hote(connecte);
  const harness = await RouterTestingHarness.create();
  const navigations: string[] = [];
  TestBed.inject(Router).events.subscribe((e) => {
    if (e instanceof NavigationStart) navigations.push(e.url);
  });
  const navigation = harness.navigateByUrl('/hote/magelian');
  await attendre();
  // jsdom ne charge pas les feuilles : on joue le `load` des polices (la feuille globale est lue par un faux).
  policesChargees();
  await attendre();
  // `match` et non `expectOne` : chaque test doit échouer pour SA raison,
  // pas tous sur l'absence de requête de configuration.
  const config = ctx.http.match((r) => r.url.endsWith('config.local.json'));
  config.forEach((r) => r.flush({ supabaseUrl: 'http://x', supabaseAnonKey: 'k', apiBaseUrl: '' }));
  await navigation;
  await attendre();
  await harness.fixture.whenStable();
  return { ...ctx, harness, navigations, configDemandee: config.length };
}

describe('remoteRoutes — monté par un hôte qui ne connaît pas app.config.ts', () => {
  afterEach(() => retirerPolices());

  it("polices, feuille globale et configuration sont lues sur l'application distante, pas sur le document de l'hôte", async () => {
    const { http, feuilles } = hote();
    const harness = await RouterTestingHarness.create();
    const navigation = harness.navigateByUrl('/hote/magelian');
    await attendre();
    const polices = document.head.querySelector('link[data-mg-polices]');
    expect(polices?.getAttribute('href')).toBe('https://distante.exemple/remotes/magelian/magelian-polices.css');
    expect(feuilles.lectures).toEqual(['https://distante.exemple/remotes/magelian/magelian.css']);
    // La feuille globale n'est PAS posée dans le document de l'hôte : elle sera adoptée par la racine d'ombre.
    expect(document.querySelector('link[href$="/magelian.css"]')).toBeNull();
    http.expectNone((r) => r.url.endsWith('config.local.json'));
    polices!.dispatchEvent(new Event('load'));
    await attendre();
    http.expectOne('https://distante.exemple/remotes/magelian/config.local.json')
      .flush({ supabaseUrl: 'http://x', supabaseAnonKey: 'k', apiBaseUrl: '' });
    await navigation;
    http.match(() => true).forEach((r) => r.flush({ retenus: 1, total: 1, par_nature: {} }));
  });

  it("l'application vit dans la racine d'ombre de RacineDistanteComponent, qui adopte la feuille globale", async () => {
    const { harness, http, feuilles } = await monter();
    http.match('/api/risques/sites/compter').forEach((r) => r.flush({ retenus: 1, total: 1, par_nature: {} }));
    const conteneur = harness.fixture.nativeElement as HTMLElement;
    const racine = ombre(conteneur);
    expect(feuilles.adoptions).toEqual([{ racine, feuille: feuilles.feuille }]);
    // La coquille est DANS l'ombre : invisible d'un querySelector du document de l'hôte.
    expect(racine.querySelector('mg-coquille')).not.toBeNull();
    expect(conteneur.querySelector('mg-coquille')).toBeNull();
  });

  it('la configuration et la session sont chargées par la route', async () => {
    const { auth, configDemandee } = await monter();
    expect(configDemandee).toBe(1);
    expect(auth.initialiser).toHaveBeenCalledTimes(1);
  });

  it('les intercepteurs s\'appliquent sans app.config (preuve de bout en bout : jetonInterceptor → HttpBaseService → HttpClient, sans cycle)', async () => {
    const { http } = await monter();
    const req = http.expectOne('/api/risques/sites/compter');
    expect(req.request.headers.get('Authorization')).toBe('Bearer jeton-test');
    req.flush({ retenus: 1, total: 1, par_nature: {} });
  });

  it('les liens restent dans le préfixe de l\'hôte', async () => {
    const { harness, http } = await monter();
    http.match('/api/risques/sites/compter').forEach((r) => r.flush({ retenus: 1, total: 1, par_nature: {} }));
    const racine = ombre(harness.fixture.nativeElement as HTMLElement);
    const lien = [...racine.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Catalogue');
    expect(lien?.getAttribute('href')).toBe('/hote/magelian/catalogue');
    lien!.click();
    await attendre();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/hote/magelian/catalogue');
    // L'accueil (exact) ne reste pas actif sur une page enfant.
    const accueil = [...racine.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Accueil');
    expect(accueil?.getAttribute('href')).toBe('/hote/magelian');
    expect(accueil?.classList.contains('bg-overlay')).toBe(false);
    expect(lien!.classList.contains('bg-overlay')).toBe(true);
  });

  it('les services d\'API reçoivent le HttpClient de la route : le limiteur tient à 3 appels', async () => {
    const { harness, http } = await monter();
    // L'appel de l'accueil, soldé d'abord : le sémaphore repart de zéro place prise.
    http.expectOne('/api/risques/sites/compter').flush({ retenus: 1, total: 1, par_nature: {} });
    await attendre();
    const api = harness.routeDebugElement!.injector.get(SitesRisqueApi);
    for (let i = 0; i < 4; i++) api.compter().subscribe();
    await attendre();
    const enVol = http.match('/api/risques/sites/compter');
    expect(enVol.length).toBe(3);
    enVol[0].flush({ retenus: 1, total: 1, par_nature: {} });
    await attendre();
    http.expectOne('/api/risques/sites/compter');
  });

  it('démarrage en échec : la racine affiche le message, jamais la coquille ni un écran blanc', async () => {
    hote();
    const http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    const navigation = harness.navigateByUrl('/hote/magelian');
    await attendre();
    policesChargees();
    await attendre();
    http.expectOne((r) => r.url.endsWith('config.local.json')).flush('absent', { status: 404, statusText: 'Not Found' });
    await navigation;
    await harness.fixture.whenStable();
    const racine = ombre(harness.fixture.nativeElement as HTMLElement);
    expect(racine.querySelector('[role="alert"]')?.textContent).toMatch(/Configuration locale introuvable.*Rechargez la page pour réessayer\.$/);
    expect(racine.querySelector('mg-coquille')).toBeNull();
    http.expectNone('/api/risques/sites/compter');
  });

  describe("sans session dans l'hôte (défaut racine : un message, jamais une navigation)", () => {
    const MESSAGE = 'Session requise — connectez-vous à AIDA pour accéder à MAGELIAN.';
    const racine = (h: RouterTestingHarness) => ombre(h.fixture.nativeElement as HTMLElement);
    const appelsApi = (http: HttpTestingController) => http.match((r) => r.url.startsWith('/api/'));

    it("(a) affiche « Session requise », reste sur l'URL de l'hôte, ne navigue pas et ne fait aucun appel d'API", async () => {
      const { harness, http, navigations } = await monter(false);

      expect(racine(harness).querySelector('[role="status"]')?.textContent?.trim()).toBe(MESSAGE);
      expect(racine(harness).querySelector('mg-coquille')).toBeNull();
      expect(TestBed.inject(Router).url).toBe('/hote/magelian');
      expect(navigations).toEqual(['/hote/magelian']);
      expect(appelsApi(http)).toEqual([]);
    });

    it("(b) quand la session apparaît, la page demandée s'affiche sans renavigation", async () => {
      const { auth, harness, http, navigations } = await monter(false);

      auth.session.set(SESSION_FACTICE);
      await attendre();
      await harness.fixture.whenStable();

      expect(racine(harness).querySelector('[role="status"]')).toBeNull();
      expect(racine(harness).querySelector('mg-coquille')).not.toBeNull();
      expect(navigations).toEqual(['/hote/magelian']);
      expect(TestBed.inject(Router).url).toBe('/hote/magelian');
      // L'accueil part enfin — avec le jeton de la session apparue.
      const req = http.expectOne('/api/risques/sites/compter');
      expect(req.request.headers.get('Authorization')).toBe('Bearer jeton-test');
      req.flush({ retenus: 1, total: 1, par_nature: {} });
    });

    it("(c) un 401 de l'API fait apparaître le même message, sans navigation ni nouvel appel", async () => {
      const { auth, harness, http, navigations } = await monter(true);

      http.expectOne('/api/risques/sites/compter').flush('non autorisé', { status: 401, statusText: 'Unauthorized' });
      await attendre();
      await harness.fixture.whenStable();

      expect(auth.deconnecter).toHaveBeenCalledWith('locale');
      expect(racine(harness).querySelector('[role="status"]')?.textContent?.trim()).toBe(MESSAGE);
      expect(racine(harness).querySelector('mg-coquille')).toBeNull();
      expect(navigations).toEqual(['/hote/magelian']);
      expect(TestBed.inject(Router).url).toBe('/hote/magelian');
      // Pas de boucle : la page détruite n'émet plus rien.
      await attendre();
      expect(appelsApi(http)).toEqual([]);
    });
  });
});
