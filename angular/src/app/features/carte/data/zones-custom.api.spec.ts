import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../core/config/config.service';
import { ZonesCustomApi } from './zones-custom.api';

function preparer() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), ZonesCustomApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  return { api: TestBed.inject(ZonesCustomApi), http: TestBed.inject(HttpTestingController) };
}

describe('ZonesCustomApi', () => {
  it('lister : GET /api/custom-geo/list avec les paramètres EXACTS de l\'appelant, dans leur ordre', () => {
    const { api, http } = preparer();
    let lu: unknown;
    api.lister(new URLSearchParams({ org_id: 'o1', _t: '42' })).subscribe((v) => (lu = v));
    const req = http.expectOne((r) => r.url.startsWith('/api/custom-geo/list'));
    expect(req.request.method).toBe('GET');
    expect(req.request.urlWithParams).toBe('/api/custom-geo/list?org_id=o1&_t=42');
    req.flush({ zones: [] });
    expect(lu).toEqual({ zones: [] });
    http.verify();
  });
});
