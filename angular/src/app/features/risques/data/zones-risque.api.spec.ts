import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../core/config/config.service';
import { ZonesRisqueApi } from './zones-risque.api';

describe('ZonesRisqueApi', () => {
  function preparer() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), ZonesRisqueApi,
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
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

  it('donne une adresse ABSOLUE des tuiles de zones, {z}/{x}/{y} intacts et profil encodé', () => {
    const { api } = preparer();
    expect(api.urlTuilesZones('h1000_b 5'))
      .toBe(`${new URL(document.baseURI).origin}/api/tiles/zones-risque/{z}/{x}/{y}?profil=h1000_b%205`);
  });

  it('prépare avec des natures : corps { profil, natures }', () => {
    const { api, http } = preparer();
    api.preparer('p', ['Explosibles']).subscribe();
    const req = http.expectOne('/api/risques/zones/preparer');
    expect(req.request.body).toEqual({ profil: 'p', natures: ['Explosibles'] });
    req.flush({});
  });

  it('tuiles avec natures : suffixe &natures= encodé comme React', () => {
    const { api } = preparer();
    expect(api.urlTuilesZones('p', ['Toxicité aiguë', 'Explosibles']))
      .toBe(`${new URL(document.baseURI).origin}/api/tiles/zones-risque/{z}/{x}/{y}?profil=p&natures=Toxicit%C3%A9%20aigu%C3%AB%2CExplosibles`);
  });

  it('sites avec filtres : bbox, limite, gravites, natures (ordre de CarteRisque.tsx)', () => {
    const { api, http } = preparer();
    api.sites('1,2,3,4', { gravites: ['seveso_haut'], natures: ['Explosibles', 'Déchets'] }).subscribe();
    const req = http.expectOne((r) => r.url === '/api/map/risques-industriels');
    expect(req.request.params.keys()).toEqual(['bbox', 'limite', 'gravites', 'natures']);
    expect(req.request.params.get('natures')).toBe('Explosibles,Déchets');
    req.flush({ type: 'FeatureCollection', features: [] });
  });

  it('courbe avec filtres : cible, gravites, natures, perim_niveau, perim_codes', () => {
    const { api, http } = preparer();
    api.courbe('seveso_haut,seveso_bas', { cible: 'ind', natures: ['GPL'], perimNiveau: 'departement', perimCode: '13' }).subscribe();
    const req = http.expectOne((r) => r.url === '/api/risques/exposition/rayon');
    expect(req.request.params.keys()).toEqual(['cible', 'gravites', 'natures', 'perim_niveau', 'perim_codes']);
    expect(req.request.params.get('perim_codes')).toBe('13');
    req.flush({ rayon_max_m: 0, n_sites: 0, courbes: [] });
  });
});
