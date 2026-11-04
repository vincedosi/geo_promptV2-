import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../config/config.service';
import { AuthService } from './auth.service';
import { CHEMIN_CONNEXION_AUTO, ConnexionAutoService } from './connexion-auto.service';

const attendre = () => new Promise((r) => setTimeout(r, 0));

function creer(ouvrir = vi.fn(async () => true), apiBaseUrl = '') {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl } } },
      { provide: AuthService, useValue: { ouvrirSession: ouvrir } },
    ],
  });
  return { service: TestBed.inject(ConnexionAutoService), http: TestBed.inject(HttpTestingController), ouvrir };
}

describe('ConnexionAutoService', () => {
  it('POST sur la route de développement puis pose les jetons rendus', async () => {
    const { service, http, ouvrir } = creer();
    const p = service.tenter();
    const req = http.expectOne(CHEMIN_CONNEXION_AUTO);
    expect(req.request.method).toBe('POST');
    req.flush({ access_token: 'a', refresh_token: 'r' });
    expect(await p).toBe(true);
    expect(ouvrir).toHaveBeenCalledWith('a', 'r');
  });

  it("préfixe l'origine de l'API de la configuration", async () => {
    const { service, http } = creer(undefined, 'http://api.test/');
    const p = service.tenter();
    http.expectOne(`http://api.test${CHEMIN_CONNEXION_AUTO}`).flush({ access_token: 'a', refresh_token: 'r' });
    expect(await p).toBe(true);
  });

  it("404 (route absente ou variables non posées) : false, et l'échec est mémorisé — aucune nouvelle requête", async () => {
    const { service, http, ouvrir } = creer();
    const p = service.tenter();
    http.expectOne(CHEMIN_CONNEXION_AUTO).flush({ error: 'Introuvable.' }, { status: 404, statusText: 'Not Found' });
    expect(await p).toBe(false);
    expect(ouvrir).not.toHaveBeenCalled();
    expect(await service.tenter()).toBe(false);
    http.expectNone(CHEMIN_CONNEXION_AUTO);
  });

  it('jetons illisibles ou session refusée par supabase : false', async () => {
    const { service, http } = creer(vi.fn(async () => false));
    const p = service.tenter();
    http.expectOne(CHEMIN_CONNEXION_AUTO).flush({ access_token: 'a', refresh_token: 'r' });
    expect(await p).toBe(false);

    const autre = creerNeuf();
    const q = autre.service.tenter();
    autre.http.expectOne(CHEMIN_CONNEXION_AUTO).flush({ access_token: 42 });
    expect(await q).toBe(false);
    expect(autre.ouvrir).not.toHaveBeenCalled();
  });

  it('appels simultanés : une seule requête en vol', async () => {
    const { service, http } = creer();
    const a = service.tenter();
    const b = service.tenter();
    await attendre();
    http.expectOne(CHEMIN_CONNEXION_AUTO).flush({ access_token: 'a', refresh_token: 'r' });
    expect(await Promise.all([a, b])).toEqual([true, true]);
  });

  it("un succès ne se mémorise pas : après une déconnexion, l'appel suivant redemande", async () => {
    const { service, http } = creer();
    const a = service.tenter();
    http.expectOne(CHEMIN_CONNEXION_AUTO).flush({ access_token: 'a', refresh_token: 'r' });
    await a;
    const b = service.tenter();
    http.expectOne(CHEMIN_CONNEXION_AUTO).flush({ access_token: 'a2', refresh_token: 'r2' });
    expect(await b).toBe(true);
  });
});

function creerNeuf() {
  TestBed.resetTestingModule();
  return creer();
}
