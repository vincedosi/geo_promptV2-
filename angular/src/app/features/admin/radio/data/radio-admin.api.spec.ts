import { TestBed } from '@angular/core/testing';
import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { RadioAdminApi, type EvenementImportRadio } from './radio-admin.api';

describe('RadioAdminApi — routes `/api/radio/*` de l’onglet Import (lot 6, T16)', () => {
  let api: RadioAdminApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), RadioAdminApi,
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    api = TestBed.inject(RadioAdminApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lectures : `stats`, `imports-history`, `import-logs/<id>` en GET, sans paramètre (React n’en passe aucun)', () => {
    api.stats().subscribe();
    api.historique().subscribe();
    api.journal('7d507127-b88e').subscribe();
    for (const url of ['/api/radio/stats', '/api/radio/imports-history', '/api/radio/import-logs/7d507127-b88e']) {
      const req = http.expectOne(url);
      expect(req.request.method).toBe('GET');
      expect(req.request.params.keys()).toEqual([]);
      req.flush({});
    }
  });

  it('ANFR et enrichissement : POST SANS corps (`adminFetch(endpoint, { method: \'POST\' })`), flux NDJSON lu en texte', () => {
    const recus: EvenementImportRadio[] = [];
    api.importerAnfr().subscribe((e) => recus.push(e));
    api.enrichir().subscribe((e) => recus.push(e));
    for (const url of ['/api/radio/import-anfr', '/api/radio/crawl-arcom']) {
      const req = http.expectOne(url);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toBeNull();
      expect(req.request.responseType).toBe('text');
      expect(req.request.reportProgress).toBe(true);
      req.event({ type: HttpEventType.DownloadProgress, loaded: 1, partialText: '{"type":"status","message":"a"}\n{"ty' });
      req.flush('{"type":"status","message":"a"}\n{"type":"done","message":"b"}\n');
    }
    expect(recus.map((e) => e.message)).toEqual(['a', 'b', 'a', 'b']);
  });

  it('ODS : multipart au SEUL champ `file` de React (`form.append(\'file\', file)`)', () => {
    const fichier = new File(['x'], 'frequences.ods');
    api.importerOds(fichier).subscribe();
    const req = http.expectOne('/api/radio/import-arcom-ods');
    expect(req.request.method).toBe('POST');
    const corps = req.request.body as FormData;
    expect(corps).toBeInstanceOf(FormData);
    expect([...corps.keys()]).toEqual(['file']);
    expect((corps.get('file') as File).name).toBe('frequences.ods');
    expect(req.request.responseType).toBe('text');
    req.flush('');
  });

  it('suppression : DELETE `/api/radio/data` qui PORTE son corps `{ target, confirm }` (HttpClient.delete + body)', () => {
    api.supprimer('emetteurs', false).subscribe();
    api.supprimer('all', true).subscribe();
    const [essai, reel] = http.match('/api/radio/data');
    expect(essai.request.method).toBe('DELETE');
    expect(essai.request.body).toEqual({ target: 'emetteurs', confirm: false });
    expect(reel.request.method).toBe('DELETE');
    expect(reel.request.body).toEqual({ target: 'all', confirm: true });
    essai.flush({ dry_run: true, would_delete: { emetteurs: 12704 } });
    reel.flush({ success: true });
  });

  it('Radios (T17) : `stations` aux paramètres EXACTS de `fetchRadios` (`page.tsx:141-160`), dans le même ordre, `search` seulement s’il est saisi', () => {
    api.stations({ page: 1, filtre: 'all', recherche: '' }).subscribe();
    const sans = http.expectOne((r) => r.url === '/api/radio/stations');
    expect(sans.request.method).toBe('GET');
    expect(sans.request.urlWithParams).toBe('/api/radio/stations?page=1&limit=20&sort=freq_desc&filter=all');
    sans.flush({ stations: [], total: 0, page: 1, limit: 20 });
    api.stations({ page: 3, filtre: 'unmatched', recherche: 'fun radio' }).subscribe();
    const avec = http.expectOne((r) => r.url === '/api/radio/stations');
    expect(avec.request.urlWithParams).toBe('/api/radio/stations?page=3&limit=20&sort=freq_desc&filter=unmatched&search=fun%20radio');
    avec.flush({ stations: [], total: 0, page: 3, limit: 20 });
  });

  it('Statistiques (T17) : `audit` en GET sans paramètre (`fetchAudit`, `page.tsx:118-125`)', () => {
    api.audit().subscribe();
    const req = http.expectOne('/api/radio/audit');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys()).toEqual([]);
    req.flush({});
  });
});
