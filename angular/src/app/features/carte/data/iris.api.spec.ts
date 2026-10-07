import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../core/config/config.service';
import { IRIS_TILE_VERSION } from '../logique/versions';
import { IrisApi } from './iris.api';

function preparer() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), IrisApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  return { api: TestBed.inject(IrisApi), http: TestBed.inject(HttpTestingController) };
}

describe('IrisApi', () => {
  it('urlTuiles : adresse ABSOLUE de /api/tiles/iris, jetons {z}/{x}/{y} intacts, version — aucun appel HTTP', () => {
    const { api, http } = preparer();
    expect(api.urlTuiles()).toBe(`${new URL('/api/tiles/iris/', document.baseURI).href}{z}/{x}/{y}?v=${IRIS_TILE_VERSION}`);
    http.verify();
  });

  it('bornes : GET /api/iris/bornes, le catalogue tel quel', () => {
    const { api, http } = preparer();
    let lu: unknown;
    api.bornes().subscribe((v) => (lu = v));
    const req = http.expectOne('/api/iris/bornes');
    expect(req.request.method).toBe('GET');
    const catalogue = { pop_15_29: { colonne: 'pop_15_29', classe: 'effectif', log_min: 0, log_max: 4, val_min: 1, val_max: 9000 } };
    req.flush(catalogue);
    expect(lu).toEqual(catalogue);
    http.verify();
  });

  it('detail : GET /api/iris/detail?code_iris=<code> (le nom que la route lit)', () => {
    const { api, http } = preparer();
    api.detail('751010101').subscribe();
    const req = http.expectOne('/api/iris/detail?code_iris=751010101');
    expect(req.request.method).toBe('GET');
    req.flush({ code_iris: '751010101' });
    http.verify();
  });
});
