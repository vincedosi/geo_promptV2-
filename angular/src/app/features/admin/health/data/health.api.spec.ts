import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { HealthApi } from './health.api';

describe('HealthApi', () => {
  it('lit GET /api/admin/health et rend la réponse telle quelle', () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), HealthApi,
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    let lu: unknown;
    TestBed.inject(HealthApi).lire().subscribe((v) => (lu = v));
    const req = TestBed.inject(HttpTestingController).expectOne('/api/admin/health');
    expect(req.request.method).toBe('GET');
    const corps = { success: true, status: 'OK', summary: 'Tout est OK', checks: [], timestamp: 't' };
    req.flush(corps);
    expect(lu).toEqual(corps);
  });
});
