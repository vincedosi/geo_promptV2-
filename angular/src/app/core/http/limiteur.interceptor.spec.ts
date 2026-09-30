import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpBaseService } from './http-base.service';
import { limiteurInterceptor } from './limiteur.interceptor';
import { SEMAPHORE_API, creerSemaphore } from './semaphore';

const attendre = () => new Promise((r) => setTimeout(r, 0));

function preparer() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([limiteurInterceptor])),
      provideHttpClientTesting(),
      { provide: HttpBaseService, useValue: { baseUrl: '/api' } },
      { provide: SEMAPHORE_API, useValue: creerSemaphore(3) },
    ],
  });
  return { http: TestBed.inject(HttpClient), ctrl: TestBed.inject(HttpTestingController) };
}

describe('limiteurInterceptor', () => {
  it('ne laisse partir que 3 appels à l\'API, le 4e attend la fin d\'un autre', async () => {
    const { http, ctrl } = preparer();
    for (let i = 1; i <= 4; i++) http.get(`/api/a${i}`).subscribe();
    await attendre();
    // ctrl.match() RETIRE les requêtes trouvées de la file d'attente interne
    // (vérifié dans @angular/common/http/testing : match() splice ses
    // résultats hors de `open`) — un expectOne('/api/a1') après un premier
    // match(() => true) chercherait dans une file déjà vidée et échouerait
    // TOUJOURS, quel que soit le comportement de l'intercepteur. On opère
    // donc sur le tableau que match() a déjà rendu, sans le requêter deux fois.
    const enVol = ctrl.match(() => true);
    expect(enVol.length).toBe(3);
    const requeteA1 = enVol.find((r) => r.request.urlWithParams === '/api/a1');
    expect(requeteA1).toBeTruthy();
    requeteA1?.flush({});
    await attendre();
    ctrl.expectOne('/api/a4');
  });

  it('un appel abandonné en file d\'attente ne garde pas de place', async () => {
    const { http, ctrl } = preparer();
    const subs = [1, 2, 3].map((i) => http.get(`/api/a${i}`).subscribe());
    const enAttente = http.get('/api/a4').subscribe();
    await attendre();
    enAttente.unsubscribe();
    subs.forEach((s) => s.unsubscribe());
    await attendre();
    // La place libérée par l'abandon ne doit jamais partir en requête réseau.
    ctrl.expectNone('/api/a4');
    for (let i = 5; i <= 7; i++) http.get(`/api/a${i}`).subscribe();
    await attendre();
    expect(ctrl.match((r) => ['/api/a5', '/api/a6', '/api/a7'].includes(r.url)).length).toBe(3);
  });

  it('une erreur libère la place', async () => {
    const { http, ctrl } = preparer();
    for (let i = 1; i <= 4; i++) http.get(`/api/a${i}`).subscribe({ error: () => undefined });
    await attendre();
    ctrl.expectOne('/api/a1').flush('', { status: 500, statusText: 'Erreur' });
    await attendre();
    ctrl.expectOne('/api/a4');
  });

  it('ne limite pas ce qui n\'est pas l\'API', async () => {
    const { http, ctrl } = preparer();
    for (let i = 1; i <= 5; i++) http.get(`/ailleurs/${i}`).subscribe();
    await attendre();
    expect(ctrl.match(() => true).length).toBe(5);
  });
});
