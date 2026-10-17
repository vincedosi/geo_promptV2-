import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import type { ParseResult } from '../../logique/types/import-poi';
import { ANALYSE_POI_ESSAI } from '../testing/import-poi.fixture';
import { ImportPoiApi } from './import-poi.api';

function monter() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), ImportPoiApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  return { api: TestBed.inject(ImportPoiApi), http: TestBed.inject(HttpTestingController) };
}

describe('ImportPoiApi — POST /api/admin/import-poi/parse (lot 6, T12)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('un fichier : multipart `file` + `files` (`page.tsx:144-152`), sans `Content-Type` (le navigateur pose la frontière), réponse rendue telle quelle', () => {
    const { api, http } = monter();
    let recu: ParseResult | null = null;
    api.analyser([new File(['a'], 'poi-essai.csv')]).subscribe((r) => (recu = r));
    const req = http.expectOne('/api/admin/import-poi/parse');
    expect(req.request.method).toBe('POST');
    const corps = req.request.body as FormData;
    expect(corps).toBeInstanceOf(FormData);
    expect([...corps.keys()]).toEqual(['file', 'files']);
    expect((corps.get('file') as File).name).toBe('poi-essai.csv');
    expect((corps.get('files') as File).name).toBe('poi-essai.csv');
    expect(req.request.headers.keys()).toEqual([]);
    req.flush(ANALYSE_POI_ESSAI);
    expect(recu).toEqual(ANALYSE_POI_ESSAI);
  });

  it('trois fichiers d’un Shapefile : `file` (le premier) puis trois `files`, dans l’ordre', () => {
    const { api, http } = monter();
    api.analyser(['z.shp', 'z.dbf', 'z.prj'].map((n) => new File(['x'], n))).subscribe();
    const corps = http.expectOne('/api/admin/import-poi/parse').request.body as FormData;
    expect([...corps.keys()]).toEqual(['file', 'files', 'files', 'files']);
    expect((corps.getAll('files') as File[]).map((f) => f.name)).toEqual(['z.shp', 'z.dbf', 'z.prj']);
    expect((corps.get('file') as File).name).toBe('z.shp');
  });
});

describe('ImportPoiApi — géocodage, essai à blanc et import en flux (lot 6, T13)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('`geocoder` : POST JSON `/api/admin/geocode/batch`, corps tel quel', () => {
    const { api, http } = monter();
    api.geocoder({ fileId: 'f-1', colAdresse: 'adresse', colCodePostal: 'code_postal', colVille: 'ville' }).subscribe();
    const req = http.expectOne('/api/admin/geocode/batch');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ fileId: 'f-1', colAdresse: 'adresse', colCodePostal: 'code_postal', colVille: 'ville' });
    req.flush({ success: false, error: 'x' });
  });

  it('`corrigerGeocodage` : POST JSON `/api/admin/geocode/update`, `{ geocodeId, rowIndex, action }`', () => {
    const { api, http } = monter();
    api.corrigerGeocodage({ geocodeId: 'g-1', rowIndex: 3, action: { type: 'ignore' } }).subscribe();
    const req = http.expectOne('/api/admin/geocode/update');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ geocodeId: 'g-1', rowIndex: 3, action: { type: 'ignore' } });
    req.flush({ success: true });
  });

  it('`essayer` : POST JSON `/api/admin/import-poi/dry-run`, corps tel quel', () => {
    const { api, http } = monter();
    api.essayer({ fileId: 'f-1', dataType: 'poi', category: 'c', mapping: {}, geolocation: { mode: 'gps' }, limit: 100 }).subscribe();
    const req = http.expectOne('/api/admin/import-poi/dry-run');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ fileId: 'f-1', dataType: 'poi', category: 'c', mapping: {}, geolocation: { mode: 'gps' }, limit: 100 });
    req.flush({ success: true });
  });

  it('`importer` : POST `/api/admin/import-poi/execute` lu en TEXTE et en flux (C4), événements `data:` découpés', () => {
    const { api, http } = monter();
    const recus: unknown[] = [];
    let fini = false;
    api.importer({ fileId: 'f-1', dataType: 'poi', mapping: {}, geolocation: { mode: 'gps' } })
      .subscribe({ next: (e) => recus.push(e), complete: () => (fini = true) });
    const req = http.expectOne('/api/admin/import-poi/execute');
    expect(req.request.method).toBe('POST');
    expect(req.request.responseType).toBe('text');
    expect(req.request.reportProgress).toBe(true);
    expect(req.request.body).toEqual({ fileId: 'f-1', dataType: 'poi', mapping: {}, geolocation: { mode: 'gps' } });
    req.flush('data: {"type":"log","logLevel":"info","logLine":"a"}\n\ndata: {"type":"complete","report":{"total":1,"inserted":1,"ignored":0,"errors":0}}\n\n');
    expect(recus).toEqual([
      { type: 'log', logLevel: 'info', logLine: 'a' },
      { type: 'complete', report: { total: 1, inserted: 1, ignored: 0, errors: 0 } },
    ]);
    expect(fini).toBe(true);
  });
});
