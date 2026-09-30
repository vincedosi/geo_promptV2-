import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from '../auth/auth.service';
import { HttpBaseService } from './http-base.service';
import { sessionExpireeInterceptor } from './session-expiree.interceptor';

function preparer() {
  const renvoyerVersConnexion = vi.fn(async () => undefined);
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([sessionExpireeInterceptor])),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: { renvoyerVersConnexion } },
      { provide: HttpBaseService, useValue: { baseUrl: '/api' } },
    ],
  });
  return {
    http: TestBed.inject(HttpClient),
    ctrl: TestBed.inject(HttpTestingController),
    renvoyerVersConnexion,
  };
}

const attendre = () => new Promise((r) => setTimeout(r, 0));

describe('sessionExpireeInterceptor', () => {
  it('renvoie vers /connexion sur un 401 de l\'API, et laisse l\'erreur remonter à la page', async () => {
    const { http, ctrl, renvoyerVersConnexion } = preparer();
    let erreurRecue: unknown;
    http.get('/api/risques/sites/compter').subscribe({ error: (e: unknown) => (erreurRecue = e) });

    ctrl.expectOne('/api/risques/sites/compter').flush('non autorisé', { status: 401, statusText: 'Unauthorized' });
    await attendre();

    expect(renvoyerVersConnexion).toHaveBeenCalledTimes(1);
    expect(erreurRecue).toBeTruthy();
  });

  it('ne fait rien sur un 401 hors de l\'API', async () => {
    const { http, ctrl, renvoyerVersConnexion } = preparer();
    http.get('/config.local.json').subscribe({ error: () => undefined });

    ctrl.expectOne('/config.local.json').flush('non autorisé', { status: 401, statusText: 'Unauthorized' });
    await attendre();

    expect(renvoyerVersConnexion).not.toHaveBeenCalled();
  });

  it('ne fait rien sur un 500 de l\'API', async () => {
    const { http, ctrl, renvoyerVersConnexion } = preparer();
    http.get('/api/risques/sites/compter').subscribe({ error: () => undefined });

    ctrl
      .expectOne('/api/risques/sites/compter')
      .flush('erreur serveur', { status: 500, statusText: 'Internal Server Error' });
    await attendre();

    expect(renvoyerVersConnexion).not.toHaveBeenCalled();
  });
});
