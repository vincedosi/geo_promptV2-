import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { ImportsApi, type ReponseImports } from './imports.api';

describe('ImportsApi', () => {
  let api: ImportsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), ImportsApi,
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    api = TestBed.inject(ImportsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lire : GET /api/admin/imports, sans corps ni paramètre (imports/page.tsx:78)', () => {
    const corps: ReponseImports = { success: true, imports: [] };
    let lu: unknown;
    api.lire().subscribe((v) => (lu = v));
    const req = http.expectOne('/api/admin/imports');
    expect(req.request.method).toBe('GET');
    expect(req.request.body).toBeNull();
    expect(req.request.params.keys()).toEqual([]);
    req.flush(corps);
    expect(lu).toEqual(corps);
  });
});
