import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpBaseService } from '../../../core/http/http-base.service';
import { ZonesRisqueApi } from './zones-risque.api';

describe('ZonesRisqueApi', () => {
  function preparer() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        { provide: HttpBaseService, useValue: { url: (c: string) => `/api/${c}` } },
      ],
    });
    return { api: TestBed.inject(ZonesRisqueApi), http: TestBed.inject(HttpTestingController) };
  }

  it('prépare les zones par POST /api/risques/zones/preparer avec le code du profil', () => {
    const { api, http } = preparer();
    let lu: unknown;
    api.preparer('h1000.2000.5000_b500.1000_a_L0_P1').subscribe((v) => (lu = v));
    const req = http.expectOne('/api/risques/zones/preparer');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ profil: 'h1000.2000.5000_b500.1000_a_L0_P1' });
    req.flush({ deja_construit: true });
    expect(lu).toEqual({ deja_construit: true });
  });

  it('lit les sites de la bbox, limités à 800', () => {
    const { api, http } = preparer();
    const fc = { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection;
    let lu: unknown;
    api.sites('4.7500,43.3500,5.3000,43.6000').subscribe((v) => (lu = v));
    const req = http.expectOne('/api/map/risques-industriels?bbox=4.7500,43.3500,5.3000,43.6000&limite=800');
    expect(req.request.method).toBe('GET');
    req.flush(fc);
    expect(lu).toEqual(fc);
  });

  it('lit la courbe de couverture par gravité', () => {
    const { api, http } = preparer();
    const rep = { rayon_max_m: 10000, n_sites: 1, courbes: [] };
    let lu: unknown;
    api.courbe('seveso_haut').subscribe((v) => (lu = v));
    const req = http.expectOne('/api/risques/exposition/rayon?gravites=seveso_haut');
    expect(req.request.method).toBe('GET');
    req.flush(rep);
    expect(lu).toEqual(rep);
  });
});
