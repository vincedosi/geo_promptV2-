import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ConfigService } from '../../../core/config/config.service';
import type { MeteoZoneChunk } from '../logique/meteo/types';
import { MeteoApi } from './meteo.api';

function preparer() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), MeteoApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  return { api: TestBed.inject(MeteoApi), http: TestBed.inject(HttpTestingController) };
}

const PARAMS = { variable: 'temperature_2m', startDate: '2026-10-03', endDate: '2026-10-09' } as const;

describe('MeteoApi', () => {
  it('donnees : la chaîne de React, dans le même ordre ; bbox SEULEMENT si fournie', () => {
    const { api, http } = preparer();
    api.donnees('departement', PARAMS).subscribe();
    const req = http.expectOne('/api/meteo-geo?scale=departement&variable=temperature_2m&startDate=2026-10-03&endDate=2026-10-09');
    expect(req.request.method).toBe('GET');
    expect(req.request.responseType).toBe('text');
    api.donnees('cp', { ...PARAMS, bbox: '4.231,43.160,5.813,43.924' }).subscribe();
    http.expectOne('/api/meteo-geo?scale=cp&variable=temperature_2m&startDate=2026-10-03&endDate=2026-10-09&bbox=4.231,43.160,5.813,43.924');
    http.verify();
  });

  it('donnees : flux NDJSON lu ligne à ligne (progression puis résultat)', () => {
    const { api, http } = preparer();
    const lus: MeteoZoneChunk[] = [];
    api.donnees('cp', PARAMS).subscribe((c) => lus.push(c));
    const req = http.expectOne((r) => r.url.startsWith('/api/meteo-geo?scale=cp'));
    const l0 = '{"status":"fetching","progress":0,"total":3}';
    const l1 = '{"status":"fetching","progress":1,"total":3,"etaMs":8000}';
    req.event({ type: HttpEventType.DownloadProgress, loaded: 1, partialText: `${l0}\n${l1.slice(0, 5)}` });
    expect(lus.map((c) => c.status)).toEqual(['fetching']);
    req.event({ type: HttpEventType.DownloadProgress, loaded: 2, partialText: `${l0}\n${l1}\n` });
    expect(lus).toHaveLength(2);
    req.flush(`${l0}\n${l1}\n{"status":"done","progress":3,"total":3,"data":{},"meta":null}`);
    expect(lus.map((c) => c.status)).toEqual(['fetching', 'fetching', 'done']);
    http.verify();
  });
});
