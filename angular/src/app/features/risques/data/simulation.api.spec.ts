import { TestBed } from '@angular/core/testing';
import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../core/config/config.service';
import { SimulationApi } from './simulation.api';

function preparer() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), SimulationApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  return { api: TestBed.inject(SimulationApi), http: TestBed.inject(HttpTestingController) };
}

describe('SimulationApi', () => {
  it('lire : GET …/simulation', () => {
    const { api, http } = preparer();
    api.lire('abc').subscribe();
    const req = http.expectOne('/api/zones/jeux/abc/simulation');
    expect(req.request.method).toBe('GET');
    req.flush({ simulation: null });
  });

  it('simuler : POST { version, params } en flux NDJSON, ligne coupée entre morceaux', () => {
    const { api, http } = preparer();
    const lus: unknown[] = [];
    let fini = false;
    api.simuler('abc', 2, { budget: 1000, graine: 7 }).subscribe({ next: (e) => lus.push(e), complete: () => (fini = true) });
    const req = http.expectOne('/api/zones/jeux/abc/simulation');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ version: 2, params: { budget: 1000, graine: 7 } });
    expect(req.request.responseType).toBe('text');
    expect(req.request.reportProgress).toBe(true);
    const l1 = '{"etape":"preparation","message":"a"}';
    const l2 = '{"etape":"insertion","message":"b","faites":1,"total":2,"pourcentage":50}';
    const l3 = '{"etape":"termine","message":"c","simulation_id":"s","lignes":2,"duree_ms":5}';
    req.event({ type: HttpEventType.DownloadProgress, loaded: 1, partialText: `${l1}\n${l2.slice(0, 10)}` });
    req.event({ type: HttpEventType.DownloadProgress, loaded: 2, partialText: `${l1}\n${l2}\n` });
    req.flush(`${l1}\n${l2}\n${l3}`); // dernière ligne SANS saut de ligne
    expect(lus.map((e) => (e as { etape: string }).etape)).toEqual(['preparation', 'insertion', 'termine']);
    expect(fini).toBe(true);
  });

  it('recaler : POST sans corps, en flux', () => {
    const { api, http } = preparer();
    api.recaler('abc').subscribe();
    const req = http.expectOne('/api/zones/jeux/abc/simulation/recaler');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBeNull();
    expect(req.request.responseType).toBe('text');
    req.flush('');
  });

  it('purger : DELETE ; carte : GET avec bbox ; export : blob', () => {
    const { api, http } = preparer();
    api.purger('abc').subscribe();
    expect(http.expectOne('/api/zones/jeux/abc/simulation').request.method).toBe('DELETE');
    api.carte('abc', '1,2,3,4').subscribe();
    http.expectOne('/api/zones/jeux/abc/simulation/carte?bbox=1,2,3,4').flush({ type: 'FeatureCollection', features: [] });
    api.exportSimulation('abc').subscribe();
    const e = http.expectOne('/api/zones/jeux/abc/simulation/export');
    expect(e.request.responseType).toBe('blob');
    e.flush(new Blob(['x']));
  });
});
