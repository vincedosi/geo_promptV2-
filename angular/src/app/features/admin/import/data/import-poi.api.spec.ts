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
