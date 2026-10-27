import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ConfigService } from '../../../core/config/config.service';
import { IsochronesApi, type EvenementFlux } from './isochrones.api';

function preparer() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), IsochronesApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  return { api: TestBed.inject(IsochronesApi), http: TestBed.inject(HttpTestingController) };
}

describe('IsochronesApi', () => {
  it('verifierCache : POST /api/isochrone-cache-check avec le corps tel quel', () => {
    const { api, http } = preparer();
    let lu: unknown;
    api.verifierCache({ category: 'cirfa', mode: 'drive', paliers: [10], metropolitaine: true }).subscribe((r) => (lu = r));
    const req = http.expectOne('/api/isochrone-cache-check');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ category: 'cirfa', mode: 'drive', paliers: [10], metropolitaine: true });
    req.flush({ total_pois: 2, total_combos: 2, cached_combos: 2, missing_combos: 0, missing_pois: 0, cached_pois: 2 });
    expect(lu).toMatchObject({ missing_combos: 0 });
    http.verify();
  });

  it('remplirCache : POST /api/isochrone-battle (route protégée, appelée telle quelle), flux NDJSON lu au fil des morceaux', () => {
    const { api, http } = preparer();
    const lus: EvenementFlux[] = [];
    api.remplirCache({ category: 'cirfa' }).subscribe((e) => lus.push(e));
    const req = http.expectOne('/api/isochrone-battle');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ category: 'cirfa' });
    req.event({ type: HttpEventType.DownloadProgress, loaded: 1, partialText: '{"type":"pois_loaded","total":2}\n{"type":"prog' });
    expect(lus).toEqual([{ type: 'pois_loaded', total: 2 }]);
    req.flush('{"type":"pois_loaded","total":2}\n{"type":"progress","completed":1,"total":2}\n');
    expect(lus.map((e) => e.type)).toEqual(['pois_loaded', 'progress']);
    http.verify();
  });

  it('un événement `error` du flux devient une erreur de l’Observable, page HTML traduite', () => {
    const { api, http } = preparer();
    const erreurs: string[] = [];
    api.batailleV2({ category: 'cirfa', mode: 'drive', metropolitaine: true, paliers: [10] }).subscribe({ error: (e: Error) => erreurs.push(e.message) });
    http.expectOne('/api/isochrone-battle-v2').flush('{"type":"pois_loaded","total":2}\n{"type":"error","message":"<html>521</html>"}\n');
    expect(erreurs).toEqual(['Service temporairement indisponible (503/521)']);
    http.verify();
  });

  it('batailleV2 : sa route, corps tel quel ; plus aucune méthode de la V1 retirée (appliquer, bataille)', () => {
    const { api, http } = preparer();
    api.batailleV2({ category: 'cirfa', mode: 'drive', metropolitaine: true, paliers: [10] }).subscribe();
    expect(http.expectOne('/api/isochrone-battle-v2').request.body).toEqual({ category: 'cirfa', mode: 'drive', metropolitaine: true, paliers: [10] });
    expect('appliquer' in api).toBe(false);
    expect('bataille' in api).toBe(false);
    http.verify();
  });
});
