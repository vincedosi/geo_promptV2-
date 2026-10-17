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
});
