import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { FraicheurApi, type ReponseFraicheur } from './fraicheur.api';

describe('FraicheurApi', () => {
  let api: FraicheurApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), FraicheurApi,
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    api = TestBed.inject(FraicheurApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const corps: ReponseFraicheur = { sources: [], mesureLe: null, dureeMs: null };

  it('lire : GET /api/admin/fraicheur-donnees, sans corps', () => {
    let lu: unknown;
    api.lire().subscribe((v) => (lu = v));
    const req = http.expectOne('/api/admin/fraicheur-donnees');
    expect(req.request.method).toBe('GET');
    req.flush(corps);
    expect(lu).toEqual(corps);
  });

  it('mesurer(false) : POST au corps { inclureLourd: false } (FraicheurPanel.tsx:161-165)', () => {
    api.mesurer(false).subscribe();
    const req = http.expectOne('/api/admin/fraicheur-donnees');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ inclureLourd: false });
    req.flush(corps);
  });

  it('mesurer(true) : POST au corps { inclureLourd: true }', () => {
    api.mesurer(true).subscribe();
    const req = http.expectOne('/api/admin/fraicheur-donnees');
    expect(req.request.body).toEqual({ inclureLourd: true });
    req.flush(corps);
  });
});
