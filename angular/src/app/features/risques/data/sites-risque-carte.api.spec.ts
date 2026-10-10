import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../core/config/config.service';
import { SitesRisqueApi } from './sites-risque.api';

/** Méthodes ajoutées au lot 4, T12 (carte principale) — la spec du lot 3 reste inchangée. */
describe('SitesRisqueApi — couche ICPE de la carte principale', () => {
  function monter() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), SitesRisqueApi,
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    return { api: TestBed.inject(SitesRisqueApi), http: TestBed.inject(HttpTestingController) };
  }

  it('carte : défaut de React — bbox, gravites, inclure_inactifs=0, sans natures, rayon ni limite', () => {
    const { api, http } = monter();
    api.carte('4.9000,43.3000,5.3000,43.6000', {
      gravites: ['seveso_haut', 'seveso_bas'], natures: [], inclureInactifs: false, rayonM: 0,
    }).subscribe();
    const req = http.expectOne((r) => r.url === '/api/map/risques-industriels');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys()).toEqual(['bbox', 'gravites', 'inclure_inactifs']);
    expect(req.request.params.get('gravites')).toBe('seveso_haut,seveso_bas');
    expect(req.request.params.get('inclure_inactifs')).toBe('0');
    req.flush({ type: 'FeatureCollection', features: [] });
  });

  it('carte : natures (valeur DÉCODÉE de React), rayon_m, inclure_inactifs=1, limite si fixée', () => {
    const { api, http } = monter();
    api.carte('1,2,3,4', {
      gravites: ['autre'], natures: ['Toxicité aiguë', 'Nature non précisée'], inclureInactifs: true, rayonM: 500, limite: 300,
    }).subscribe();
    const req = http.expectOne((r) => r.url === '/api/map/risques-industriels');
    expect(req.request.params.keys()).toEqual(['bbox', 'gravites', 'inclure_inactifs', 'natures', 'rayon_m', 'limite']);
    expect(req.request.params.get('natures')).toBe('Toxicité aiguë,Nature non précisée');
    expect(req.request.params.get('rayon_m')).toBe('500');
    expect(req.request.params.get('inclure_inactifs')).toBe('1');
    expect(req.request.params.get('limite')).toBe('300');
    req.flush({ type: 'FeatureCollection', features: [] });
  });

  it('exposition : identifiant encodé', () => {
    const { api, http } = monter();
    let lu: unknown;
    api.exposition('a/b').subscribe((v) => (lu = v));
    http.expectOne('/api/risques/a%2Fb/exposition').flush({ mode: 'pprt', indicatif: false, paliers: [] });
    expect(lu).toEqual({ mode: 'pprt', indicatif: false, paliers: [] });
  });
});
