import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { QualiteApi, type ReponseQualite } from './qualite.api';

describe('QualiteApi', () => {
  let api: QualiteApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), QualiteApi,
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    api = TestBed.inject(QualiteApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lire : GET /api/admin/qualite-donnees, sans corps', () => {
    const corps: ReponseQualite = { verifications: [] };
    let lu: unknown;
    api.lire().subscribe((v) => (lu = v));
    const req = http.expectOne('/api/admin/qualite-donnees');
    expect(req.request.method).toBe('GET');
    expect(req.request.body).toBeNull();
    req.flush(corps);
    expect(lu).toEqual(corps);
  });

  it('verifier : POST au corps EXACT { verification } — une seule clé (page.tsx:137)', () => {
    api.verifier('invariants').subscribe();
    const req = http.expectOne('/api/admin/qualite-donnees');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ verification: 'invariants' });
    req.flush({});
  });
});
