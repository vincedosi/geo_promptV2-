import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { remoteRoutes } from './app.routes';
import { AuthService } from './core/auth/auth.service';
import { SitesRisqueApi } from './features/risques/data/sites-risque.api';

/**
 * Le shell AIDA ne charge QUE `remoteRoutes` (doc §4.4-4.5) : ni app.config.ts,
 * ni index.html, ni APP_INITIALIZER. Cet hôte simulé fournit ce qu'un shell
 * fournit a priori — un routeur, un HttpClient SANS nos intercepteurs — et
 * monte l'application sous un préfixe qu'elle ne connaît pas.
 */
function authFactice() {
  return {
    connecte: signal(true),
    email: signal<string | null>('test@exemple.fr'),
    session: signal(null),
    jeton: async () => 'jeton-test',
    initialiser: vi.fn(async () => undefined),
    deconnecter: vi.fn(async () => undefined),
    renvoyerVersConnexion: vi.fn(async () => undefined),
  };
}

function hote() {
  const auth = authFactice();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([{ path: 'hote/magelian', children: remoteRoutes }]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: auth },
    ],
  });
  return { auth, http: TestBed.inject(HttpTestingController) };
}

const attendre = () => new Promise((r) => setTimeout(r, 0));

/** Monte l'application sous le préfixe de l'hôte ; la configuration est servie par l'hôte factice. */
async function monter() {
  const ctx = hote();
  const harness = await RouterTestingHarness.create();
  const navigation = harness.navigateByUrl('/hote/magelian');
  await attendre();
  // `match` et non `expectOne` : chaque test doit échouer pour SA raison,
  // pas tous sur l'absence de requête de configuration.
  const config = ctx.http.match((r) => r.url.endsWith('config.local.json'));
  config.forEach((r) => r.flush({ supabaseUrl: 'http://x', supabaseAnonKey: 'k', apiBaseUrl: '' }));
  await navigation;
  await attendre();
  await harness.fixture.whenStable();
  return { ...ctx, harness, configDemandee: config.length };
}

describe('remoteRoutes — monté par un hôte qui ne connaît pas app.config.ts', () => {
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
    const racine = harness.fixture.nativeElement as HTMLElement;
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
    http.expectOne((r) => r.url.endsWith('config.local.json')).flush('absent', { status: 404, statusText: 'Not Found' });
    await navigation;
    await harness.fixture.whenStable();
    const racine = harness.fixture.nativeElement as HTMLElement;
    expect(racine.querySelector('[role="alert"]')?.textContent).toMatch(/Configuration locale introuvable/);
    expect(racine.querySelector('mg-coquille')).toBeNull();
    http.expectNone('/api/risques/sites/compter');
  });
});
