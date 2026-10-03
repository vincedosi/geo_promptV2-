import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type Provider, computed, provideZonelessChangeDetection, signal } from '@angular/core';
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
  });

  it("essai-carte est un écran PLEIN ÉCRAN : sous la racine distante, sans coquille ni barre latérale, et garde de session", async () => {
    class Observateur { observe = vi.fn(); disconnect = vi.fn(); }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = Observateur;
    const factices: Provider[] = [
      { provide: FABRIQUE_CARTE, useValue: (o: never) => new CarteFactice(o) },
      { provide: CouleursService, useValue: { palette: (j: Record<string, string>) => signal(Object.fromEntries(Object.keys(j).map((k) => [k, `teinte-${k}`]))) } },
      { provide: FABRIQUE_GRAPHIQUE, useValue: () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }) },
    ];
    const { harness, http } = await monter(true, factices);
    http.match('/api/risques/sites/compter').forEach((r) => r.flush({ retenus: 1, total: 1, par_nature: {} }));
    await harness.navigateByUrl('/hote/magelian/essai-carte');
    await attendre();
    await harness.fixture.whenStable();
    const racine = ombre(harness.fixture.nativeElement as HTMLElement);
    expect(racine.querySelector('mg-essai-carte')).not.toBeNull();
    expect(racine.querySelector('mg-coquille')).toBeNull();
    expect(racine.querySelector('mg-barre-laterale')).toBeNull();
    expect(TestBed.inject(Router).url).toBe('/hote/magelian/essai-carte');
    // Le lien de retour (la croix « Fermer » de l'en-tête, comme React) est RELATIF : le préfixe de montage est inconnu.
    const retour = racine.querySelector('a[aria-label="Fermer"]');
    expect(retour?.getAttribute('href')).toBe('/hote/magelian');
    http.match(() => true);
  });

  it("le lien « Essai carte » de la coquille mène à l'écran plein écran : mg-essai-carte monté, plus aucune coquille", async () => {
    class Observateur { observe = vi.fn(); disconnect = vi.fn(); }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = Observateur;
    const factices: Provider[] = [
      { provide: FABRIQUE_CARTE, useValue: (o: never) => new CarteFactice(o) },
      { provide: CouleursService, useValue: { palette: (j: Record<string, string>) => signal(Object.fromEntries(Object.keys(j).map((k) => [k, `teinte-${k}`]))) } },
      { provide: FABRIQUE_GRAPHIQUE, useValue: () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }) },
    ];
    const { harness, http } = await monter(true, factices);
    http.match('/api/risques/sites/compter').forEach((r) => r.flush({ retenus: 1, total: 1, par_nature: {} }));
    const racine = ombre(harness.fixture.nativeElement as HTMLElement);
    expect(racine.querySelector('mg-coquille')).not.toBeNull();
    const lien = [...racine.querySelectorAll('a')].find((a) => a.getAttribute('aria-label') === 'Essai carte');
    expect(lien?.getAttribute('href')).toBe('/hote/magelian/essai-carte');
    lien!.click();
    await attendre();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/hote/magelian/essai-carte');
    expect(racine.querySelector('mg-essai-carte')).not.toBeNull();
    expect(racine.querySelector('mg-coquille')).toBeNull();
    http.match(() => true);
  });

  it("essai-carte sans session : le message de session, jamais la page ni un appel d'API", async () => {
    const { harness, http } = await monter(false);
    await harness.navigateByUrl('/hote/magelian/essai-carte');
    await attendre();
    const racine = ombre(harness.fixture.nativeElement as HTMLElement);
    expect(racine.querySelector('[role="status"]')).not.toBeNull();
    expect(racine.querySelector('mg-essai-carte')).toBeNull();
    expect(http.match((r) => r.url.startsWith('/api/'))).toEqual([]);
  });

  it("risques est une route PLEIN ÉCRAN sœur de la coquille, gardée par authGuard", () => {
    const racine = remoteRoutes[0];
    const risques = racine.children?.find((r) => r.path === 'risques');
    expect(risques?.canActivate).toEqual([authGuard]);
    expect(risques?.loadComponent).toBeDefined();
    // Hors de la coquille : la route de chemin vide (coquille) ne la porte pas parmi ses enfants.
    const coquille = racine.children?.find((r) => r.path === '');
    expect(coquille?.children?.some((r) => r.path === 'risques')).toBe(false);
  });

  it("risques : monté sans coquille ; changer d'étape réécrit `?risque=` sous le préfixe de l'hôte SANS recréer l'écran ni la carte", async () => {
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
    expect(cartes).toHaveLength(1);
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
    expect(cartes).toHaveLength(1);
    expect(cartes[0].retiree).toBe(false);
    expect(racine.querySelector('[role="alert"]')).toBeNull();
    // Retour à l'étape par défaut : le paramètre disparaît, l'URL de l'hôte reste.
    expect(TestBed.inject(Router).url).toBe('/hote/magelian/risques');
    http.match(() => true);
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
