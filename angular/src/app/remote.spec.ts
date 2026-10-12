import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { EnvironmentInjector, Injectable, type Provider, computed, createEnvironmentInjector, getDebugNode, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationStart, Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { remoteRoutes } from './app.routes';
import { AuthService } from './core/auth/auth.service';
import { BASE_RESSOURCES } from './core/ressources/ressource-distante';
import { feuillesFactices, ombre, policesChargees, retirerPolices } from './core/ressources/testing/feuilles-factices';
import { FABRIQUE_CARTE } from './carte/fabrique-carte';
import { CarteFactice } from './carte/testing/carte-factice';
import { CouleursService } from './core/theme/couleurs.service';
import { FABRIQUE_GRAPHIQUE } from './graphiques/fabrique-graphique';
import { SitesRisqueApi } from './features/risques/data/sites-risque.api';
import { authGuard } from './core/auth/auth.guard';
import { HttpBaseService } from './core/http/http-base.service';
import { RoleAdminService } from './features/admin/etat/role-admin.service';

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
    lireRole: vi.fn(async () => null),
    lireProfil: vi.fn(async () => null),
    // Comme le vrai : une fin de session, même locale, met la session à null.
    deconnecter: vi.fn(async (_portee?: string) => session.set(null)),
  };
}

function hote(connecte = true, extra: Provider[] = []) {
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
      ...extra,
    ],
  });
  return { auth, feuilles, http: TestBed.inject(HttpTestingController) };
}

const attendre = () => new Promise((r) => setTimeout(r, 0));

/**
 * Carte principale ET module risque montés ensemble (T13) : plus de trois lectures au montage, le limiteur en garde en
 * FILE. `http.match` seul ne les solde pas : la fin du test les annule, libère des places, et la file lance les
 * suivantes APRÈS la destruction de l'injecteur (NG0205 dans `jetonInterceptor`). On les fait échouer — chaque
 * service sait dire un échec — jusqu'à ce que la file soit vide.
 */
async function solderLaFile(http: HttpTestingController): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const enVol = http.match(() => true);
    if (enVol.length === 0) return;
    enVol.forEach((r) => r.error(new ProgressEvent('error')));
    await attendre();
  }
}
/**
 * Délai explicite des deux tests qui DÉMARRENT l'application puis naviguent (lien de la coquille, relance après
 * échec) : lancé seul, ce fichier les a mesurés de 6 741 à 8 284 ms à froid (polices, démarrage, coquille), à la
 * base comme après — au-delà des 5 000 ms par défaut, sans défaut de code. Même patron que `app.config.spec.ts`.
 *
 * 30 s depuis la revue finale du lot 4 (M-1, 2026-10-12) : à 15 s, « les liens restent dans le préfixe de l'hôte »
 * a dépassé le délai dans la suite complète sur un hôte à court de RAM, alors qu'il passe seul. C'est la CHARGE DE
 * L'HÔTE qui est couverte, pas un défaut : ne pas redescendre ce délai.
 */
const DELAI_DEMARRAGE_REEL = 30_000;

/** Monte l'application sous le préfixe de l'hôte ; la configuration est servie par l'hôte factice. */
async function monter(connecte = true, extra: Provider[] = []) {
  const ctx = hote(connecte, extra);
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
  // Le badge de session lit les organisations au montage de la coquille : soldé ici, pour que
  // chaque test ne voie que SES appels (et que le limiteur reparte de zéro place prise).
  ctx.http.match('/api/user/organizations').forEach((r) => r.flush({ organizations: [], active_org_id: null, is_super_admin: false }));
  await attendre();
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

  it("le <html> de l'hôte (ici SANS classe) n'est jamais écrit : ni au montage, ni par la bascule de thème", async () => {
    const html = document.documentElement;
    html.className = '';
    html.removeAttribute('style');
    try {
      const { harness, http } = await monter();
      http.match('/api/risques/sites/compter').forEach((r) => r.flush({ retenus: 1, total: 1, par_nature: {} }));
      expect(html.className).toBe('');
      expect(html.getAttribute('style')).toBeNull();
      const hoteRacine = (harness.fixture.nativeElement as HTMLElement).querySelector('mg-racine-distante')!;
      const theme = hoteRacine.classList.contains('light') ? 'light' : 'dark';
      const bouton = [...ombre(harness.fixture.nativeElement as HTMLElement).querySelectorAll('button')]
        .find((b) => /^Basculer le thème/.test(b.getAttribute('aria-label') ?? ''));
      bouton!.click();
      await attendre();
      await harness.fixture.whenStable();
      expect(html.className).toBe('');
      expect(html.getAttribute('style')).toBeNull();
      // Seule NOTRE racine a basculé (`:host(.light)`).
      expect(hoteRacine.classList.contains(theme === 'light' ? 'dark' : 'light')).toBe(true);
    } finally {
      localStorage.clear();
    }
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
    const lien = [...racine.querySelectorAll('a')].find((a) => a.getAttribute('aria-label') === 'Catalogue');
    expect(lien?.getAttribute('href')).toBe('/hote/magelian/catalogue');
    lien!.click();
    await attendre();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/hote/magelian/catalogue');
    // L'accueil (exact) ne reste pas actif sur une page enfant.
    const accueil = [...racine.querySelectorAll('a')].find((a) => a.getAttribute('aria-label') === 'Accueil');
    expect(accueil?.getAttribute('href')).toBe('/hote/magelian');
    expect(accueil?.classList.contains('bg-overlay')).toBe(false);
    expect(lien!.classList.contains('bg-overlay')).toBe(true);
  }, DELAI_DEMARRAGE_REEL);

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

  it("après un échec, une navigation ENFANT (menu du shell) relance le démarrage, et l'application s'affiche", async () => {
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
    expect(ombre(harness.fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')).not.toBeNull();

    // Le shell navigue vers une page enfant : la route racine est RÉUTILISÉE, son garde doit tout de même repartir.
    const relance = harness.navigateByUrl('/hote/magelian/catalogue');
    await attendre();
    http.expectOne((r) => r.url.endsWith('config.local.json'))
      .flush({ supabaseUrl: 'http://x', supabaseAnonKey: 'k', apiBaseUrl: '' });
    await relance;
    await attendre();
    await harness.fixture.whenStable();
    const racine = ombre(harness.fixture.nativeElement as HTMLElement);
    expect(racine.querySelector('[role="alert"]')).toBeNull();
    expect(racine.querySelector('mg-coquille')).not.toBeNull();
    expect(TestBed.inject(Router).url).toBe('/hote/magelian/catalogue');
  }, DELAI_DEMARRAGE_REEL);

  it("carte est une route PLEIN ÉCRAN sœur de la coquille, gardée par authGuard, avec son outlet enfant", () => {
    const racine = remoteRoutes[0];
    const carte = racine.children?.find((r) => r.path === 'carte');
    expect(carte?.canActivate).toEqual([authGuard]);
    expect(carte?.loadComponent).toBeDefined();
    // Son outlet porte le module risque (T13, B2).
    expect(carte?.children?.map((r) => r.path)).toEqual(['risques']);
    const coquille = racine.children?.find((r) => r.path === '');
    expect(coquille?.children?.some((r) => r.path === 'carte')).toBe(false);
  });

  it("carte : montée sans coquille sous le préfixe de l'hôte ; « Explorer » de la coquille y mène", async () => {
    class Observateur { observe = vi.fn(); disconnect = vi.fn(); }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = Observateur;
    const cartes: CarteFactice[] = [];
    const factices: Provider[] = [
      { provide: FABRIQUE_CARTE, useValue: (o: never) => { const c = new CarteFactice(o); cartes.push(c); return c; } },
    ];
    const { harness, http } = await monter(true, factices);
    http.match('/api/risques/sites/compter').forEach((r) => r.flush({ retenus: 1, total: 1, par_nature: {} }));
    const racine = ombre(harness.fixture.nativeElement as HTMLElement);
    const explorer = [...racine.querySelectorAll('mg-barre-laterale a')].find((a) => a.textContent?.includes('Explorer'))!;
    expect(explorer.getAttribute('href')).toBe('/hote/magelian/carte');
    (explorer as HTMLAnchorElement).click();
    for (let i = 0; i < 3; i++) { await attendre(); await harness.fixture.whenStable(); }
    expect(TestBed.inject(Router).url).toBe('/hote/magelian/carte');
    expect(racine.querySelector('mg-carte-principale')).not.toBeNull();
    expect(racine.querySelector('mg-coquille')).toBeNull();
    expect(cartes).toHaveLength(1);
    http.match(() => true);
  });

  it("carte sans session : le message de session, jamais l'écran ni un appel d'API", async () => {
    const { harness, http } = await monter(false);
    await harness.navigateByUrl('/hote/magelian/carte');
    await attendre();
    const racine = ombre(harness.fixture.nativeElement as HTMLElement);
    expect(racine.querySelector('[role="status"]')).not.toBeNull();
    expect(racine.querySelector('mg-carte-principale')).toBeNull();
    expect(http.match((r) => r.url.startsWith('/api/'))).toEqual([]);
  });

  it("risques (T13) : l'ancienne adresse REDIRIGE, relativement, vers l'enfant `risques` de la carte ; hors de la coquille", () => {
    const racine = remoteRoutes[0];
    const risques = racine.children?.find((r) => r.path === 'risques');
    expect(risques?.redirectTo).toBe('carte/risques');
    expect(risques?.loadComponent).toBeUndefined();
    const carte = racine.children?.find((r) => r.path === 'carte');
    const module = carte?.children?.find((r) => r.path === 'risques');
    expect(module?.loadComponent).toBeDefined();
    // Gardé par la carte, son parent : aucun garde à recopier sur l'enfant.
    expect(carte?.canActivate).toEqual([authGuard]);
    const coquille = racine.children?.find((r) => r.path === '');
    expect(coquille?.children?.some((r) => r.path === 'risques')).toBe(false);
  });

  it("risques : `/risques?risque=etape%3Dzones` → redirigé vers `carte/risques`, préfixe de l'hôte ET paramètre gardés", async () => {
    class Observateur { observe = vi.fn(); disconnect = vi.fn(); }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = Observateur;
    const factices: Provider[] = [{ provide: FABRIQUE_CARTE, useValue: (o: never) => new CarteFactice(o) }];
    const { harness, http } = await monter(true, factices);
    http.match('/api/risques/sites/compter').forEach((r) => r.flush({ retenus: 1, total: 1, par_nature: {} }));
    await harness.navigateByUrl('/hote/magelian/risques?risque=etape%3Dzones');
    for (let i = 0; i < 3; i++) { await attendre(); await harness.fixture.whenStable(); }
    expect(TestBed.inject(Router).url).toBe('/hote/magelian/carte/risques?risque=etape%3Dzones');
    const racine = ombre(harness.fixture.nativeElement as HTMLElement);
    expect(racine.querySelector('mg-carte-principale mg-risque')).not.toBeNull();
    await solderLaFile(http);
  });

  it("risques : monté SUR la carte, sans coquille ; changer d'étape réécrit `?risque=` sous le préfixe de l'hôte SANS recréer l'écran ni aucune carte", async () => {
    class Observateur { observe = vi.fn(); disconnect = vi.fn(); }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = Observateur;
    const cartes: CarteFactice[] = [];
    const factices: Provider[] = [
      { provide: FABRIQUE_CARTE, useValue: (o: never) => { const c = new CarteFactice(o); cartes.push(c); return c; } },
    ];
    const { harness, http, auth } = await monter(true, factices);
    http.match('/api/risques/sites/compter').forEach((r) => r.flush({ retenus: 1, total: 1, par_nature: {} }));
    await harness.navigateByUrl('/hote/magelian/risques');
    for (let i = 0; i < 3; i++) { await attendre(); await harness.fixture.whenStable(); }
    const racine = ombre(harness.fixture.nativeElement as HTMLElement);
    const page = racine.querySelector('mg-risque');
    expect(page).not.toBeNull();
    expect(racine.querySelector('mg-coquille')).toBeNull();
    // Carte principale dessous (T13), puis rayons + codes postaux (T15 : la seconde est montée à largeur nulle dès
    // l'ouverture, comme React).
    expect(cartes).toHaveLength(3);
    const initialiser = auth.initialiser.mock.calls.length;

    for (const libelle of ['Rayon', 'Couverture', 'Sites']) {
      const bouton = [...racine.querySelectorAll<HTMLButtonElement>('nav[aria-label="Étapes du parcours"] button')]
        .find((b) => b.textContent?.includes(libelle))!;
      bouton.click();
      for (let i = 0; i < 3; i++) { await attendre(); await harness.fixture.whenStable(); }
    }
    // `runGuardsAndResolvers: 'always'` rejoue le garde de démarrage à chaque navigation de requête :
    // `demarrer()` est idempotent — aucun redémarrage, aucun écran recréé, aucune carte remontée.
    expect(auth.initialiser.mock.calls.length).toBe(initialiser);
    expect(http.match((r) => r.url.endsWith('config.local.json'))).toEqual([]);
    expect(racine.querySelector('mg-risque')).toBe(page);
    expect(cartes).toHaveLength(3);
    expect(cartes.map((c) => c.retiree)).toEqual([false, false, false]);
    expect(racine.querySelector('mg-risque [role="alert"]')).toBeNull();
    // Retour à l'étape par défaut : le paramètre disparaît, l'URL de l'hôte reste.
    expect(TestBed.inject(Router).url).toBe('/hote/magelian/carte/risques');
    await solderLaFile(http);
  });

  it("risques sans session : le message de session, jamais l'écran ni un appel d'API", async () => {
    const { harness, http } = await monter(false);
    await harness.navigateByUrl('/hote/magelian/risques?risque=etape%3Drayon');
    await attendre();
    const racine = ombre(harness.fixture.nativeElement as HTMLElement);
    expect(racine.querySelector('[role="status"]')).not.toBeNull();
    expect(racine.querySelector('mg-risque')).toBeNull();
    expect(http.match((r) => r.url.startsWith('/api/'))).toEqual([]);
  });

  describe("sans session dans l'hôte (défaut racine : un message, jamais une navigation)", () => {
    const MESSAGE = 'Session requise — connectez-vous à AIDA pour accéder à dentsu.explore.';
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

    it("(d) « Deconnexion » : le même message, sans aucune navigation", async () => {
      const { auth, harness, http, navigations } = await monter(true);
      http.expectOne('/api/risques/sites/compter').flush({ retenus: 1, total: 1, par_nature: {} });
      racine(harness).querySelector<HTMLButtonElement>('[data-declencheur="utilisateur"]')!.click();
      await attendre();
      await harness.fixture.whenStable();
      const bouton = [...racine(harness).querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Deconnexion');
      bouton!.click();
      await attendre();
      await harness.fixture.whenStable();

      expect(auth.deconnecter).toHaveBeenCalledTimes(1);
      expect(racine(harness).querySelector('[role="status"]')?.textContent?.trim()).toBe(MESSAGE);
      expect(racine(harness).querySelector('mg-coquille')).toBeNull();
      expect(navigations).toEqual(['/hote/magelian']);
      expect(TestBed.inject(Router).url).toBe('/hote/magelian');
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

/** Sonde : un service d'API comme ceux de l'administration, fourni par l'injecteur de la route `admin`. */
@Injectable()
class SondeAdminApi extends HttpBaseService {
  ping() {
    return this.httpClient.get(`${this.baseUrl}/admin/sonde`);
  }
}

describe('administration (lot 6)', () => {
  afterEach(() => retirerPolices());

  /** Réponse minimale de GET /api/admin/health, lue par la page Health check (T3). */
  const DIAGNOSTIC_VIDE = { success: true, status: 'OK', summary: 'OK', checks: [], timestamp: '' };

  const racineOmbre = (h: RouterTestingHarness) => ombre(h.fixture.nativeElement as HTMLElement);
  const stabiliser = async (h: RouterTestingHarness) => {
    for (let i = 0; i < 3; i++) { await attendre(); await h.fixture.whenStable(); }
  };

  /** Monte l'application, avec une session porteuse d'un identifiant et un profil du rôle demandé. */
  async function monterAdmin(role: string) {
    const ctx = await monter();
    ctx.http.match('/api/risques/sites/compter').forEach((r) => r.flush({ retenus: 1, total: 1, par_nature: {} }));
    ctx.auth.session.set(Object.assign({}, SESSION_FACTICE, { user: { email: 'test@exemple.fr', id: 'u-1' } }));
    ctx.auth.lireProfil.mockResolvedValue({ role, nom: 'Test' } as never);
    await stabiliser(ctx.harness);
    return ctx;
  }

  it('`admin` est le DERNIER enfant de la coquille, en chargement paresseux (C1)', () => {
    const coquille = remoteRoutes[0].children?.find((r) => r.path === '');
    const enfants = coquille?.children ?? [];
    expect(enfants.at(-1)?.path).toBe('admin');
    expect(enfants.at(-1)?.loadChildren).toBeDefined();
  });

  it('super_admin : `admin` mène à `admin/systeme/sante`, dans la coquille, sans changer de préfixe', async () => {
    const { harness, http } = await monterAdmin('super_admin');
    await harness.navigateByUrl('/hote/magelian/admin');
    await stabiliser(harness);
    expect(TestBed.inject(Router).url).toBe('/hote/magelian/admin/systeme/sante');
    expect(racineOmbre(harness).querySelector('mg-coquille mg-cadre-admin mg-systeme mg-health')).not.toBeNull();
    // La page Health check (T3) lit son diagnostic : UNE requête, avec le Bearer, et rien d'autre.
    const diagnostic = http.expectOne('/api/admin/health');
    expect(diagnostic.request.headers.get('Authorization')).toBe('Bearer jeton-test');
    diagnostic.flush(DIAGNOSTIC_VIDE);
    expect(http.match((r) => r.url.startsWith('/api/'))).toEqual([]);
  });

  it('T6 : l’ancienne `admin/health` redirige vers `admin/systeme/sante` SOUS le préfixe ; les onglets y restent', async () => {
    const { harness, http } = await monterAdmin('super_admin');
    await harness.navigateByUrl('/hote/magelian/admin/health');
    await stabiliser(harness);
    expect(TestBed.inject(Router).url).toBe('/hote/magelian/admin/systeme/sante');
    http.expectOne('/api/admin/health').flush(DIAGNOSTIC_VIDE);
    const onglets = [...racineOmbre(harness).querySelectorAll('mg-systeme [role="tab"]')];
    expect(onglets.map((a) => a.getAttribute('href'))).toEqual([
      '/hote/magelian/admin/systeme/sante', '/hote/magelian/admin/systeme/fraicheur',
    ]);
    expect(onglets.map((a) => a.getAttribute('aria-selected'))).toEqual(['true', 'false']);
  });

  it('un service fourni sous la route `admin` part avec le Bearer et passe par le limiteur (4 appels → 3 en vol)', async () => {
    const { harness, http } = await monterAdmin('super_admin');
    await harness.navigateByUrl('/hote/magelian/admin/systeme/sante');
    await stabiliser(harness);
    // L'injecteur d'environnement de la route `admin` (celui qui porte FOURNISSEURS_ADMIN), lu depuis la
    // page qu'elle a montée — `routeDebugElement` désigne la racine distante, pas la page.
    // Libère la place du limiteur prise par la lecture du diagnostic (T3).
    http.expectOne('/api/admin/health').flush(DIAGNOSTIC_VIDE);
    await attendre();
    const page = racineOmbre(harness).querySelector('mg-health')!;
    const envAdmin = getDebugNode(page)!.injector.get(EnvironmentInjector);
    expect(envAdmin.get(RoleAdminService, null)).not.toBeNull();
    const sonde = createEnvironmentInjector([SondeAdminApi], envAdmin).get(SondeAdminApi);
    for (let i = 0; i < 4; i++) sonde.ping().subscribe();
    await attendre();
    const enVol = http.match('/api/admin/sonde');
    expect(enVol.length).toBe(3);
    expect(enVol.every((r) => r.request.headers.get('Authorization') === 'Bearer jeton-test')).toBe(true);
    enVol[0].flush({});
    await attendre();
    http.expectOne('/api/admin/sonde').flush({});
    enVol.slice(1).forEach((r) => r.flush({}));
  });

  it("client qui suit `admin/systeme` : le message de refus, URL inchangée, aucune page ni requête d'API", async () => {
    const { harness, http, navigations } = await monterAdmin('client');
    navigations.length = 0;
    await harness.navigateByUrl('/hote/magelian/admin/systeme/sante');
    await stabiliser(harness);
    const racine = racineOmbre(harness);
    expect(racine.querySelector('mg-cadre-admin [data-refus]')?.textContent?.trim())
      .toBe('Accès réservé aux super-administrateurs.');
    expect(racine.querySelector('mg-systeme')).toBeNull();
    expect(racine.querySelector('mg-health')).toBeNull();
    expect(TestBed.inject(Router).url).toBe('/hote/magelian/admin/systeme/sante');
    expect(navigations).toEqual(['/hote/magelian/admin/systeme/sante']);
    expect(http.match((r) => r.url.startsWith('/api/'))).toEqual([]);
  });
});
