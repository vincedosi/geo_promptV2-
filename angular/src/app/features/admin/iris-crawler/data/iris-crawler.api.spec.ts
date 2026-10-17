import { TestBed } from '@angular/core/testing';
import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { FLUX_IMPORT_IRIS } from '../testing/iris-manual-import.fixture';
import { IrisCrawlerApi, type EvenementImportIris } from './iris-crawler.api';

function monter() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), IrisCrawlerApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  return { api: TestBed.inject(IrisCrawlerApi), http: TestBed.inject(HttpTestingController) };
}

describe('IrisCrawlerApi — routes app/api/iris-crawler/** (lot 6, T15)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('dépôt : POST multipart, les TROIS champs de React (`file`, `encoding: utf-8`, `separator: auto`)', () => {
    const { api, http } = monter();
    const fichier = new File(['IRIS;DEC_MED21\n340320502;21450\n'], 'iris-essai.csv', { type: 'text/csv' });
    api.deposer(fichier).subscribe();
    const req = http.expectOne('/api/iris-crawler/manual-upload');
    expect(req.request.method).toBe('POST');
    const corps = req.request.body as FormData;
    expect(corps).toBeInstanceOf(FormData);
    expect([...corps.keys()]).toEqual(['file', 'encoding', 'separator']);
    expect((corps.get('file') as File).name).toBe('iris-essai.csv');
    expect(corps.get('encoding')).toBe('utf-8');
    expect(corps.get('separator')).toBe('auto');
    req.flush({});
  });

  it('import : POST JSON `{ sessionId, irisKeyCol, mapping }`, réponse lue en flux NDJSON (texte, progression)', () => {
    const { api, http } = monter();
    const recus: EvenementImportIris[] = [];
    let fini = false;
    api.importer({ sessionId: 's-1', irisKeyCol: 'IRIS', mapping: { DEC_MED21: 'rev_median' } })
      .subscribe({ next: (e) => recus.push(e), complete: () => (fini = true) });
    const req = http.expectOne('/api/iris-crawler/manual-import');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ sessionId: 's-1', irisKeyCol: 'IRIS', mapping: { DEC_MED21: 'rev_median' } });
    expect(req.request.responseType).toBe('text');
    expect(req.request.reportProgress).toBe(true);
    // Coupé au milieu d'une ligne : la ligne attend le morceau suivant.
    const coupe = FLUX_IMPORT_IRIS.indexOf('"percent":83');
    req.event({ type: HttpEventType.DownloadProgress, loaded: coupe, partialText: FLUX_IMPORT_IRIS.slice(0, coupe) });
    expect(recus.map((e) => e.type)).toEqual(['status', 'status', 'progress']);
    req.flush(FLUX_IMPORT_IRIS);
    expect(recus.map((e) => e.type)).toEqual(['status', 'status', 'progress', 'progress', 'progress', 'done']);
    expect(fini).toBe(true);
  });
});
