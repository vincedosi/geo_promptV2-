import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../core/config/config.service';
import { SitesRisqueApi } from './sites-risque.api';

describe('SitesRisqueApi', () => {
  it('lit /api/risques/sites/compter', () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), SitesRisqueApi,
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

  it('compte avec filtres : gravites, perim_niveau et perim_codes, dans cet ordre', () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), SitesRisqueApi,
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    TestBed.inject(SitesRisqueApi)
      .compter({ gravites: ['seveso_haut', 'seveso_bas'], perimNiveau: 'departement', perimCode: '13' })
      .subscribe();
    const req = TestBed.inject(HttpTestingController).expectOne(
      '/api/risques/sites/compter?gravites=seveso_haut,seveso_bas&perim_niveau=departement&perim_codes=13',
    );
    expect(req.request.method).toBe('GET');
    req.flush({ retenus: 1, total: 2, par_nature: {} });
  });

  it('natures accentuées : la valeur DÉCODÉE est celle de React ; périmètre incomplet ignoré', () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), SitesRisqueApi,
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    TestBed.inject(SitesRisqueApi)
      .compter({ natures: ['Toxicité aiguë', 'GPL (butane)'], perimNiveau: 'region', perimCode: null })
      .subscribe();
    const req = TestBed.inject(HttpTestingController).expectOne((r) => r.url === '/api/risques/sites/compter');
    expect(req.request.params.get('natures')).toBe('Toxicité aiguë,GPL (butane)');
    expect(req.request.params.has('perim_niveau')).toBe(false);
    expect(req.request.params.has('gravites')).toBe(false);
    // Ce que React émet pour la même valeur, relu par le serveur.
    const react = new URLSearchParams({ natures: 'Toxicité aiguë,GPL (butane)' });
    expect(new URLSearchParams(req.request.urlWithParams.split('?')[1]).get('natures')).toBe(react.get('natures'));
    req.flush({ retenus: 0, total: 0, par_nature: {} });
  });
});
