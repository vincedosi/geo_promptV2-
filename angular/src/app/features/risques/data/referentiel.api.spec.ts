import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../core/config/config.service';
import { ReferentielApi } from './referentiel.api';

function preparer() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), ReferentielApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  return { api: TestBed.inject(ReferentielApi), http: TestBed.inject(HttpTestingController) };
}

describe('ReferentielApi', () => {
  it('geo : GET /api/ref/geo', () => {
    const { api, http } = preparer();
    let lu: unknown;
    api.geo().subscribe((v) => (lu = v));
    http.expectOne('/api/ref/geo').flush({ regions: [] });
    expect(lu).toEqual({ regions: [] });
  });

  it('contours : GET /api/meteo-geo/zones?scale=', () => {
    const { api, http } = preparer();
    api.contours('departement').subscribe();
    const req = http.expectOne('/api/meteo-geo/zones?scale=departement');
    expect(req.request.method).toBe('GET');
    req.flush({ type: 'FeatureCollection', features: [] });
  });
});
