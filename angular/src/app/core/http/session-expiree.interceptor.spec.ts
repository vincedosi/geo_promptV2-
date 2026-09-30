import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from '../auth/auth.service';
import { HttpBaseService } from './http-base.service';
import { sessionExpireeInterceptor } from './session-expiree.interceptor';

function preparer() {
  const deconnecter = vi.fn(async (_portee?: string) => undefined);
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([sessionExpireeInterceptor])),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: { deconnecter } },
      { provide: HttpBaseService, useValue: { baseUrl: '/api' } },
    ],
  });
  return {
    http: TestBed.inject(HttpClient),
    ctrl: TestBed.inject(HttpTestingController),
    deconnecter,
  };
}

const attendre = () => new Promise((r) => setTimeout(r, 0));

describe('sessionExpireeInterceptor', () => {
  it('termine la session LOCALEMENT sur un 401 de l\'API, et laisse l\'erreur remonter à la page', async () => {
    // La décision de naviguer (autonome) ou d'afficher « Session requise » (hôte)
    // appartient à RacineDistanteComponent, qui voit la session passer à null.
    const { http, ctrl, deconnecter } = preparer();
    let erreurRecue: unknown;
    http.get('/api/risques/sites/compter').subscribe({ error: (e: unknown) => (erreurRecue = e) });

    ctrl.expectOne('/api/risques/sites/compter').flush('non autorisé', { status: 401, statusText: 'Unauthorized' });
    await attendre();

    expect(deconnecter).toHaveBeenCalledTimes(1);
    expect(deconnecter).toHaveBeenCalledWith('locale');
    expect(erreurRecue).toBeTruthy();
  });

  it('ne fait rien sur un 401 hors de l\'API', async () => {
    const { http, ctrl, deconnecter } = preparer();
    http.get('/config.local.json').subscribe({ error: () => undefined });

    ctrl.expectOne('/config.local.json').flush('non autorisé', { status: 401, statusText: 'Unauthorized' });
    await attendre();

    expect(deconnecter).not.toHaveBeenCalled();
  });

  it('ne fait rien sur un 500 de l\'API', async () => {
    const { http, ctrl, deconnecter } = preparer();
    http.get('/api/risques/sites/compter').subscribe({ error: () => undefined });

    ctrl
      .expectOne('/api/risques/sites/compter')
      .flush('erreur serveur', { status: 500, statusText: 'Internal Server Error' });
    await attendre();

    expect(deconnecter).not.toHaveBeenCalled();
  });
});
