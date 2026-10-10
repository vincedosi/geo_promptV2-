import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ConfigService } from '../../../core/config/config.service';
import { CiviqueApi, type LigneDepartement, type LigneIngestion } from './civique.api';

function preparer() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), CiviqueApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  return { api: TestBed.inject(CiviqueApi), http: TestBed.inject(HttpTestingController) };
}

describe('CiviqueApi', () => {
  it('geojsonVariable : GET avec la bbox VISIBLE fournie (jamais le monde)', () => {
    const { api, http } = preparer();
    api.geojsonVariable('abstention_pres_2022', '4.2000,43.1000,5.9000,43.9500').subscribe();
    const req = http.expectOne('/api/insee-variables/abstention_pres_2022/geojson?bbox=4.2000,43.1000,5.9000,43.9500');
    expect(req.request.method).toBe('GET');
    http.verify();
  });

  it('detailCp : GET /api/insee-variables/cp-detail?cp=', () => {
    const { api, http } = preparer();
    api.detailCp('13001').subscribe();
    http.expectOne('/api/insee-variables/cp-detail?cp=13001');
    http.verify();
  });

  it('santeCommune : GET /api/civic-indicators/health/<commune> (revue 1)', () => {
    const { api, http } = preparer();
    api.santeCommune('13055').subscribe();
    expect(http.expectOne('/api/civic-indicators/health/13055').request.method).toBe('GET');
    http.verify();
  });

  it('zones : GET /api/meteo-geo/zones?scale=', () => {
    const { api, http } = preparer();
    api.zones('departement').subscribe();
    http.expectOne('/api/meteo-geo/zones?scale=departement');
    http.verify();
  });

  it('santeCp : la chaîne de React, bbox SEULEMENT si fournie', () => {
    const { api, http } = preparer();
    api.santeCp('pollen', null).subscribe();
    http.expectOne('/api/civic-indicators/health-map?dataset=pollen&scale=cp&min_level=0&metric=global');
    api.santeCp('atmo', '-5.5,41.2,9.8,51.2').subscribe();
    http.expectOne('/api/civic-indicators/health-map?dataset=atmo&scale=cp&min_level=0&metric=global&bbox=-5.5,41.2,9.8,51.2');
    http.verify();
  });

  it('santeDepartement : flux NDJSON lu ligne à ligne, au fil des morceaux', () => {
    const { api, http } = preparer();
    const lus: LigneDepartement[] = [];
    api.santeDepartement('pollen').subscribe((l) => lus.push(l));
    const req = http.expectOne('/api/civic-indicators/health-map?dataset=pollen&scale=departement');
    expect(req.request.responseType).toBe('text');
    const meta = '{"type":"meta","total":2}';
    const d1 = '{"type":"dept","code_dept":"13","nom_dept":"Bouches-du-Rhône"}';
    req.event({ type: HttpEventType.DownloadProgress, loaded: 1, partialText: `${meta}\n${d1.slice(0, 8)}` });
    expect(lus.map((l) => l.type)).toEqual(['meta']);
    req.event({ type: HttpEventType.DownloadProgress, loaded: 2, partialText: `${meta}\n${d1}\n` });
    expect(lus.map((l) => l.type)).toEqual(['meta', 'dept']);
    req.flush(`${meta}\n${d1}\n{"type":"done","fetched":1,"failed":0}`);
    expect(lus.map((l) => l.type)).toEqual(['meta', 'dept', 'done']);
    http.verify();
  });

  it('ingerer : POST sans corps, en flux NDJSON', () => {
    const { api, http } = preparer();
    const lus: LigneIngestion[] = [];
    api.ingerer().subscribe((l) => lus.push(l));
    const req = http.expectOne('/api/admin/civic-ingest');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBeNull();
    req.flush('{"type":"progress","message":"a"}\n');
    expect(lus).toEqual([{ type: 'progress', message: 'a' }]);
    http.verify();
  });
});
