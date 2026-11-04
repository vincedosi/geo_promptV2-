import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { appConfig } from './app.config';
import { CHEMIN_CONNEXION_AUTO } from './core/auth/connexion-auto.service';
import { MESSAGE_CONNEXION_AUTO_ECHOUEE, MESSAGE_SESSION_FERMEE_LOCALE } from './core/auth/strategie-sans-session';
import { SUPABASE } from './core/auth/supabase';
import { ConfigService } from './core/config/config.service';
import { ECRIRE_HTML } from './core/theme/theme.service';
import { BASE_RESSOURCES } from './core/ressources/ressource-distante';
import { feuillesFactices, ombre, retirerPolices } from './core/ressources/testing/feuilles-factices';

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

/**
 * Délai explicite des tests de ce fichier qui DÉMARRENT VRAIMENT l'application (routeur, garde de démarrage, racine
 * d'ombre, coquille) : seuls, ils prennent quelques centaines de millisecondes ; dans la suite complète, exécutée en
 * parallèle sur tous les cœurs, l'un d'eux a été mesuré à 6 170 ms — au-delà des 5 000 ms par défaut de Vitest,
 * sans le moindre défaut de code. Le délai couvre la charge ; les attentes, elles, portent sur des conditions.
 *
 * 30 s depuis la revue finale du lot 4 (M-1, 2026-10-12) : à 15 s, « un SIGNED_OUT de GoTrue… » (alors une redirection vers la page de connexion, supprimée le 2026-11-05)
 * a dépassé le délai dans la suite complète sur un hôte à court de RAM (« environment 9 186 s » au rapport Vitest),
 * alors qu'il passe seul. C'est la CHARGE DE L'HÔTE qui est couverte, pas un défaut : ne pas redescendre ce délai.
 */
const DELAI_DEMARRAGE_REEL = 30_000;

/** Base où l'application est servie — distincte du document, comme dans le shell. */
const BASE = 'https://distante.exemple/remotes/magelian/chunk-ABC.js';
const URL_CONFIG = 'https://distante.exemple/remotes/magelian/config.local.json';

/**
 * Feuilles simulées (jsdom ne sert ni `fetch` distant ni `adoptedStyleSheets`) :
 * une nouvelle trace par test, pour vérifier ce qui a été lu.
 */
let feuilles = feuillesFactices();

/**
 * jsdom ne charge pas les feuilles : on joue le `load` des polices, et on
 * vérifie que la feuille globale a bien été LUE sur l'application distante.
 */
async function feuilleGlobaleChargee(): Promise<void> {
  expect(feuilles.lectures).toEqual(['https://distante.exemple/remotes/magelian/magelian.css']);
  const lien = document.head.querySelector('link[data-mg-polices]');
  expect(lien?.getAttribute('href')).toBe('https://distante.exemple/remotes/magelian/magelian-polices.css');
  lien!.dispatchEvent(new Event('load'));
  await attendre();
}

describe('appConfig — démarrage réel, lancement autonome', () => {
  beforeEach(() => (feuilles = feuillesFactices()));
  afterEach(() => retirerPolices());

  it("le lancement autonome — et lui seul — autorise ThemeService à écrire <html> (ECRIRE_HTML = true)", () => {
    const fourni = appConfig.providers.find(
      (p) => typeof p === 'object' && p !== null && 'provide' in p && p.provide === ECRIRE_HTML,
    ) as { useValue?: unknown } | undefined;
    expect(fourni?.useValue).toBe(true);
  });

  it('`/` mène à `/app`, la configuration étant chargée PAR LA ROUTE (sans Bearer), puis l\'API reçoit le Bearer', async () => {
    TestBed.configureTestingModule({
      providers: [...appConfig.providers, provideHttpClientTesting(), { provide: SUPABASE, useValue: fauxSupabase() }, { provide: BASE_RESSOURCES, useValue: BASE }, ...feuilles.providers],
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
  }, DELAI_DEMARRAGE_REEL);

  it('une ancienne adresse (`/catalogue`) retombe dans l\'application via `**` → `app`', async () => {
    TestBed.configureTestingModule({
      providers: [...appConfig.providers, provideHttpClientTesting(), { provide: SUPABASE, useValue: fauxSupabase() }, { provide: BASE_RESSOURCES, useValue: BASE }, ...feuilles.providers],
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
  }, DELAI_DEMARRAGE_REEL);

  describe('fin de session en lancement autonome — un message en place, jamais de navigation (plus de page de connexion, 2026-11-05)', () => {
    /** Un faux client Supabase qui, comme le vrai, émet SIGNED_OUT à chaque signOut. */
    function supabaseAvecSession(connecte: boolean) {
      let session: unknown = connecte ? { access_token: 'jeton-a', user: { email: 'a@exemple.test' } } : null;
      let rappel: ((evt: string, s: unknown) => void) | null = null;
      const signOut = vi.fn(async (_arg?: unknown) => {
        session = null;
        rappel?.('SIGNED_OUT', null);
        return { error: null };
      });
      // Connexion automatique de développement : pose la session comme le vrai client (SIGNED_IN).
      const setSession = vi.fn(async (j: { access_token: string }) => {
        session = { access_token: j.access_token, user: { email: 'auto@exemple.test' } };
        rappel?.('SIGNED_IN', session);
        return { data: { session }, error: null };
      });
      return {
        signOut,
        setSession,
        emettre: (evt: string, s: unknown) => {
          session = s;
          rappel?.(evt, s);
        },
        auth: {
          getSession: async () => ({ data: { session }, error: null }),
          onAuthStateChange: (cb: (evt: string, s: unknown) => void) => {
            rappel = cb;
            return { data: { subscription: { unsubscribe() {} } } };
          },
          signOut,
          setSession,
        },
      };
    }

    /**
     * Sans session, en développement (les specs tournent hors production), `authGuard` tente d'abord la
     * connexion automatique (`/api/dev/connexion-auto`, 2026-11-02). Par défaut on lui répond 404 — la route
     * hors `next dev` ou sans variables — pour éprouver le message d'échec en place ; `jetons` éprouve le succès.
     */
    async function demarrer(url: string, connecte: boolean, auto: 'refus' | 'jetons' = 'refus') {
      const client = supabaseAvecSession(connecte);
      TestBed.configureTestingModule({
        providers: [...appConfig.providers, provideHttpClientTesting(), { provide: SUPABASE, useValue: client }, { provide: BASE_RESSOURCES, useValue: BASE }, ...feuilles.providers],
      });
      const http = TestBed.inject(HttpTestingController);
      const harness = await RouterTestingHarness.create();
      const navigation = harness.navigateByUrl(url);
      await attendre();
      await feuilleGlobaleChargee();
      http.expectOne(URL_CONFIG).flush({ supabaseUrl: 'http://x', supabaseAnonKey: 'k', apiBaseUrl: '' });
      if (!connecte) {
        let auto_: ReturnType<HttpTestingController['match']> = [];
        for (let i = 0; i < 50 && auto_.length === 0; i++) {
          await attendre();
          auto_ = http.match(CHEMIN_CONNEXION_AUTO);
        }
        expect(auto_.length, 'la connexion automatique doit être tentée une fois').toBe(1);
        if (auto === 'jetons') auto_[0].flush({ access_token: 'jeton-auto', refresh_token: 'rafraichissement-auto' });
        else auto_[0].flush({ error: 'Introuvable.' }, { status: 404, statusText: 'Not Found' });
      }
      await navigation;
      await attendre();
      await harness.fixture.whenStable();
      return { client, http, harness, router: TestBed.inject(Router) };
    }

    /** Laisse le routeur, l'effet de la racine et la détection de changement aller au bout. */
    async function stabiliser(harness: RouterTestingHarness) {
      for (let i = 0; i < 3; i++) {
        await attendre();
        await harness.fixture.whenStable();
      }
    }

    /** Le message que la racine affiche à la place des pages, sans session. */
    const statut = (harness: RouterTestingHarness) =>
      ombre(harness.fixture.nativeElement as HTMLElement).querySelector('[role="status"]')?.textContent?.trim();

    /**
     * Attend une CONDITION (le message attendu) plutôt qu'un nombre fixe de tours : sous charge, l'affichage qui suit
     * un événement de GoTrue peut prendre plus de trois tours de boucle. Borné, pour échouer lisiblement.
     */
    async function attendreStatut(harness: RouterTestingHarness, attendu: string) {
      for (let i = 0; i < 50 && statut(harness) !== attendu; i++) await stabiliser(harness);
    }

    it('sans session, connexion automatique en échec : la page reste à son adresse et dit de vérifier DEV_CONNEXION_AUTO_*', async () => {
      const { router, http, harness } = await demarrer('/app/catalogue', false);
      await attendreStatut(harness, MESSAGE_CONNEXION_AUTO_ECHOUEE);
      expect(router.url).toBe('/app/catalogue');
      expect(statut(harness)).toBe(MESSAGE_CONNEXION_AUTO_ECHOUEE);
      http.expectNone('/api/risques/sites/compter');
    }, DELAI_DEMARRAGE_REEL);

    it('sans session, connexion automatique de développement réussie : la page demandée s\'ouvre sans écran de connexion', async () => {
      const { router, client, http } = await demarrer('/app/catalogue', false, 'jetons');
      expect(client.setSession).toHaveBeenCalledWith({ access_token: 'jeton-auto', refresh_token: 'rafraichissement-auto' });
      expect(router.url).toBe('/app/catalogue');
      http.match(() => true).forEach((r) => r.flush({ retenus: 1, total: 1, par_nature: {} }));
    }, DELAI_DEMARRAGE_REEL);

    it("sans session : la carte principale affiche le message en place, sans aucun appel d'API", async () => {
      const { router, http, harness } = await demarrer('/app/carte', false);
      await attendreStatut(harness, MESSAGE_CONNEXION_AUTO_ECHOUEE);
      expect(router.url).toBe('/app/carte');
      expect(statut(harness)).toBe(MESSAGE_CONNEXION_AUTO_ECHOUEE);
      http.expectNone((r) => r.url.startsWith('/api/'));
    }, DELAI_DEMARRAGE_REEL);

    it("« Explorer » de la barre latérale mène à /app/carte", async () => {
      const { http, harness } = await demarrer('/app', true);
      http.expectOne('/api/risques/sites/compter').flush({ retenus: 1, total: 1, par_nature: {} });
      http.match('/api/user/organizations').forEach((r) => r.flush({ organizations: [], active_org_id: null, is_super_admin: false }));
      await stabiliser(harness);
      const racine = ombre(harness.fixture.nativeElement as HTMLElement);
      const explorer = [...racine.querySelectorAll('mg-barre-laterale a')].find((a) => a.textContent?.includes('Explorer'));
      expect(explorer?.getAttribute('href')).toBe('/app/carte');
    }, DELAI_DEMARRAGE_REEL);

    it("sans session : l'ancienne adresse risques, redirigée vers carte/risques, garde son état d'URL et affiche le message, sans aucun appel d'API", async () => {
      const { router, http, harness } = await demarrer('/app/risques?risque=etape%3Drayon', false);
      await attendreStatut(harness, MESSAGE_CONNEXION_AUTO_ECHOUEE);
      // La redirection (T13) passe AVANT le garde : l'adresse est la nouvelle, paramètre `risque` compris.
      expect(router.url).toBe('/app/carte/risques?risque=etape%3Drayon');
      expect(statut(harness)).toBe(MESSAGE_CONNEXION_AUTO_ECHOUEE);
      http.expectNone((r) => r.url.startsWith('/api/'));
    }, DELAI_DEMARRAGE_REEL);

    it('« Deconnexion » (menu utilisateur) ferme la session sans naviguer : « Session fermée — rechargez… »', async () => {
      const { router, http, harness, client } = await demarrer('/app', true);
      http.expectOne('/api/risques/sites/compter').flush({ retenus: 1, total: 1, par_nature: {} });
      http.match('/api/user/organizations').forEach((r) => r.flush({ organizations: [], active_org_id: null, is_super_admin: false }));
      ombre(harness.fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-declencheur="utilisateur"]')!.click();
      await stabiliser(harness);
      const bouton = [...ombre(harness.fixture.nativeElement as HTMLElement).querySelectorAll('button')]
        .find((b) => b.textContent?.trim() === 'Deconnexion')!;
      bouton.click();
      await stabiliser(harness);
      expect(client.signOut).toHaveBeenCalled();
      await attendreStatut(harness, MESSAGE_SESSION_FERMEE_LOCALE);
      expect(router.url).toBe('/app');
      expect(statut(harness)).toBe(MESSAGE_SESSION_FERMEE_LOCALE);
    }, DELAI_DEMARRAGE_REEL);

    it("les deux entrées du module risque (lien de développement, tuile de l'accueil) mènent à /app/carte/risques", async () => {
      const { http, harness } = await demarrer('/app', true);
      http.expectOne('/api/risques/sites/compter').flush({ retenus: 1259, total: 99152, par_nature: {} });
      http.match('/api/user/organizations').forEach((r) => r.flush({ organizations: [], active_org_id: null, is_super_admin: false }));
      await stabiliser(harness);
      const racine = ombre(harness.fixture.nativeElement as HTMLElement);
      const dev = [...racine.querySelectorAll('a')].find((a) => a.getAttribute('aria-label') === 'Module risque');
      expect(dev?.getAttribute('href')).toBe('/app/carte/risques');
      const tuile = [...racine.querySelectorAll('mg-tuile-chiffre')].find((t) => t.textContent?.includes('Sites à risque'))!;
      expect(tuile.closest('a')?.getAttribute('href')).toBe('/app/carte/risques');
    }, DELAI_DEMARRAGE_REEL);

    it("un 401 de l'API ferme la session et affiche le message en place, sans naviguer", async () => {
      const { router, http, harness, client } = await demarrer('/app', true);
      http.expectOne('/api/risques/sites/compter').flush('non autorisé', { status: 401, statusText: 'Unauthorized' });
      await attendreStatut(harness, MESSAGE_SESSION_FERMEE_LOCALE);
      expect(client.signOut).toHaveBeenCalledWith({ scope: 'local' });
      expect(router.url).toBe('/app');
      expect(statut(harness)).toBe(MESSAGE_SESSION_FERMEE_LOCALE);
    }, DELAI_DEMARRAGE_REEL);

    it('un SIGNED_OUT de GoTrue en cours de page affiche le message en place, sans naviguer', async () => {
      const { router, http, harness, client } = await demarrer('/app/catalogue', true);
      http.match(() => true).forEach((r) => r.flush({ retenus: 1, total: 1, par_nature: {} }));
      client.emettre('SIGNED_OUT', null);
      await attendreStatut(harness, MESSAGE_SESSION_FERMEE_LOCALE);
      expect(router.url).toBe('/app/catalogue');
      expect(statut(harness)).toBe(MESSAGE_SESSION_FERMEE_LOCALE);
    }, DELAI_DEMARRAGE_REEL);

    it("démarrage en échec : la racine affiche l'erreur et ne redirige pas", async () => {
      TestBed.configureTestingModule({
        providers: [...appConfig.providers, provideHttpClientTesting(), { provide: SUPABASE, useValue: supabaseAvecSession(false) }, { provide: BASE_RESSOURCES, useValue: BASE }, ...feuilles.providers],
      });
      const http = TestBed.inject(HttpTestingController);
      const harness = await RouterTestingHarness.create();
      const navigation = harness.navigateByUrl('/app');
      await attendre();
      await feuilleGlobaleChargee();
      http.expectOne(URL_CONFIG).flush('absent', { status: 404, statusText: 'Not Found' });
      await navigation;
      await stabiliser(harness);
      expect(TestBed.inject(Router).url).toBe('/app');
      expect(ombre(harness.fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')).not.toBeNull();
    }, DELAI_DEMARRAGE_REEL);
  });
});

describe('administration (lot 6)', () => {
  beforeEach(() => (feuilles = feuillesFactices()));
  afterEach(() => retirerPolices());

  /** Supabase factice : une session porteuse d'un identifiant, un profil `super_admin`. */
  function supabaseSuperAdmin() {
    const session = { access_token: 'jeton-admin', user: { id: 'u-admin', email: 'admin@exemple.test' } };
    const profil = { data: { role: 'super_admin', full_name: 'Admin' }, error: null };
    return {
      auth: {
        getSession: async () => ({ data: { session }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
      from: () => ({ select: () => ({ eq: () => ({ single: async () => profil }) }) }),
    };
  }

  it('`/app/admin` mène à `/app/admin/systeme/sante` (C1 : React répond 404 sur /admin ; T6 : page Système)', async () => {
    TestBed.configureTestingModule({
      providers: [...appConfig.providers, provideHttpClientTesting(), { provide: SUPABASE, useValue: supabaseSuperAdmin() }, { provide: BASE_RESSOURCES, useValue: BASE }, ...feuilles.providers],
    });
    const http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    const navigation = harness.navigateByUrl('/app/admin');
    // La reconnaissance de `/app/admin` charge d'abord le chunk paresseux de l'administration : le garde de
    // démarrage (qui lit la feuille globale) ne part qu'après. On attend la CONDITION, borné.
    for (let i = 0; i < 50 && feuilles.lectures.length === 0; i++) await attendre();
    await feuilleGlobaleChargee();
    http.expectOne(URL_CONFIG).flush({ supabaseUrl: 'http://x', supabaseAnonKey: 'k', apiBaseUrl: '' });
    await navigation;
    for (let i = 0; i < 3; i++) {
      await attendre();
      await harness.fixture.whenStable();
    }
    expect(TestBed.inject(Router).url).toBe('/app/admin/systeme/sante');
    expect(ombre(harness.fixture.nativeElement as HTMLElement).querySelector('mg-cadre-admin mg-systeme mg-health')).not.toBeNull();
    http.match(() => true);
  }, DELAI_DEMARRAGE_REEL);
});
