import { TestBed } from '@angular/core/testing';
import type { HttpEvent } from '@angular/common/http';
import { HttpClient, HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type Observable, of } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { HttpBaseService } from './http-base.service';
import { jetonInterceptor } from './jeton.interceptor';

function preparer(jeton: string | null) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([jetonInterceptor])),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: { jeton: async () => jeton } },
      { provide: HttpBaseService, useValue: { apiUrl: '/api' } },
    ],
  });
  return { http: TestBed.inject(HttpClient), ctrl: TestBed.inject(HttpTestingController) };
}

const attendre = () => new Promise((r) => setTimeout(r, 0));

describe('jetonInterceptor', () => {
  it('pose le Bearer sur un appel à l\'API', async () => {
    const { http, ctrl } = preparer('jeton-a');
    http.get('/api/risques/sites/compter').subscribe();
    await attendre();
    expect(ctrl.expectOne('/api/risques/sites/compter').request.headers.get('Authorization')).toBe('Bearer jeton-a');
  });

  it('ne pose rien sans session', async () => {
    const { http, ctrl } = preparer(null);
    http.get('/api/risques/sites/compter').subscribe();
    await attendre();
    expect(ctrl.expectOne('/api/risques/sites/compter').request.headers.has('Authorization')).toBe(false);
  });

  it('n\'envoie jamais le jeton hors de l\'API', async () => {
    const { http, ctrl } = preparer('jeton-a');
    http.get('/config.local.json').subscribe();
    await attendre();
    expect(ctrl.expectOne('/config.local.json').request.headers.has('Authorization')).toBe(false);
  });

  it('relit le jeton à CHAQUE abonnement (item 2 : defer, pas from) — un futur retry ne doit jamais rejouer un jeton périmé', () => {
    let appels = 0;
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { jeton: async () => { appels++; return 'jeton-a'; } } },
        { provide: HttpBaseService, useValue: { apiUrl: '/api' } },
      ],
    });
    const req = new HttpRequest('GET', '/api/risques/sites/compter');
    const suivant = () => of({}) as unknown as Observable<HttpEvent<unknown>>;
    const resultat = TestBed.runInInjectionContext(() => jetonInterceptor(req, suivant));

    // Deux abonnements à LA MÊME observable retournée par l'intercepteur : un
    // `from(promesse)` déjà créée à l'appel de la fonction rejouerait la même
    // promesse (donc le même jeton) ; `defer(() => auth.jeton())` relit à
    // chaque abonnement.
    resultat.subscribe();
    resultat.subscribe();

    expect(appels).toBe(2);
  });
});
