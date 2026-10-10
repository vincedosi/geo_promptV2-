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

  it('stats, géométrie, suppression : chemins et verbes de React', () => {
    const { api, http } = preparer();
    api.stats('o1', 7).subscribe();
    api.geometrie('z1').subscribe();
    api.supprimer('z1').subscribe();
    expect(http.expectOne('/api/custom-geo/stats?org_id=o1&_t=7').request.method).toBe('GET');
    expect(http.expectOne('/api/custom-geo/z1/geometry').request.method).toBe('GET');
    expect(http.expectOne('/api/custom-geo/z1').request.method).toBe('DELETE');
    http.verify();
  });

  it('opération booléenne : POST /api/custom-geo/source/<route> avec le corps tel quel', () => {
    const { api, http } = preparer();
    api.operation('difference', { zone_base: 'a', zones_retirees: ['b'] }).subscribe();
    const req = http.expectOne('/api/custom-geo/source/difference');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ zone_base: 'a', zones_retirees: ['b'] });
    http.verify();
  });

  it('enregistrer : POST /api/custom-geo/save, réponse COMPLÈTE (le 207 se lit sur le statut)', () => {
    const { api, http } = preparer();
    let statut = 0;
    api.enregistrer({ name: 'n', source_type: 'composite', source_metadata: {}, geometry: { type: 'Point', coordinates: [0, 0] }, org_id: 'o' })
      .subscribe((r) => (statut = r.status));
    http.expectOne('/api/custom-geo/save').flush({ zone_id: 'z', warning: 'zone_created_but_resolution_failed' }, { status: 207, statusText: 'Multi-Status' });
    expect(statut).toBe(207);
    http.verify();
  });

  it('exporter : GET …/export?format=… en blob, réponse complète', () => {
    const { api, http } = preparer();
    api.exporter('z1', 'bidding_script').subscribe();
    const req = http.expectOne('/api/custom-geo/z1/export?format=bidding_script');
    expect(req.request.responseType).toBe('blob');
    http.verify();
  });
});
