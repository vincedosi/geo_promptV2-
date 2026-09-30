import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../core/config/config.service';
import { SitesRisqueApi } from './sites-risque.api';

describe('SitesRisqueApi', () => {
  it('lit /api/risques/sites/compter', () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    let lu: unknown;
    TestBed.inject(SitesRisqueApi).compter().subscribe((v) => (lu = v));
    TestBed.inject(HttpTestingController)
      .expectOne('/api/risques/sites/compter')
      .flush({ retenus: 1259, total: 1259, par_nature: {} });
    expect(lu).toEqual({ retenus: 1259, total: 1259, par_nature: {} });
  });
});
