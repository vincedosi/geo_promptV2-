import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ConfigService } from '../../../core/config/config.service';
import { CarteApi, type CorpsPois } from './carte.api';

function preparer() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), CarteApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  return { api: TestBed.inject(CarteApi), http: TestBed.inject(HttpTestingController) };
}

describe('CarteApi', () => {
  it('pprt : bbox seule par défaut (comme React) ; types joints et limite seulement si fournis', () => {
    const { api, http } = preparer();
    api.pprt('4.9000,43.3000,5.3000,43.6000', []).subscribe();
    http.expectOne('/api/map/pprt?bbox=4.9000,43.3000,5.3000,43.6000').flush({ type: 'FeatureCollection', features: [] });
    api.pprt('1,2,3,4', ['enveloppe', 'indetermine'], 300).subscribe();
    http.expectOne('/api/map/pprt?bbox=1,2,3,4&types=enveloppe,indetermine&limite=300').flush({ type: 'FeatureCollection', features: [] });
    http.verify();
  });

  it('pois : POST /api/map/pois (le seul verbe de la route), le corps tel quel', () => {
    const { api, http } = preparer();
    const corps: CorpsPois = {
      poi_types: ['lycee'], scope: 'metro', regions: [], depts: [], ville: '', rayon_poi: null, poi_natures: {}, bbox: [-5.5, 41.2, 9.8, 51.2],
    };
    api.pois(corps).subscribe();
    const req = http.expectOne('/api/map/pois');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(corps);
    req.flush({});
    http.verify();
  });

  it('categories : GET /api/map/categories ; rafraîchir → ?refresh=1', () => {
    const { api, http } = preparer();
    api.categories().subscribe();
    expect(http.expectOne('/api/map/categories').request.method).toBe('GET');
    api.categories(true).subscribe();
    http.expectOne('/api/map/categories?refresh=1');
    http.verify();
  });

  it('ooh : POST /api/map/ooh', () => {
    const { api, http } = preparer();
    api.ooh({ regies: [] }).subscribe();
    const req = http.expectOne('/api/map/ooh');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ regies: [] });
    http.verify();
  });

  it('transport : bbox de la carte à 4 décimales ; types joints par une virgule, absents sans type', () => {
    const { api, http } = preparer();
    api.transport([5.123456, 43.2, 5.5, 43.40001], ['bus', 'tram']).subscribe();
    const req = http.expectOne('/api/map/transport?west=5.1235&south=43.2000&east=5.5000&north=43.4000&types=bus,tram');
    expect(req.request.method).toBe('GET');
    api.transport([5, 43, 6, 44], []).subscribe();
    http.expectOne('/api/map/transport?west=5.0000&south=43.0000&east=6.0000&north=44.0000');
    http.verify();
  });

  it('poiNatures : GET ?categorie= encodé ; territoryMask : POST { scale, codes }', () => {
    const { api, http } = preparer();
    api.poiNatures('lycée pro').subscribe();
    const n = http.expectOne((r) => r.url === '/api/map/poi-natures');
    expect(n.request.params.get('categorie')).toBe('lycée pro');
    api.territoryMask('departement', ['13']).subscribe();
    const m = http.expectOne('/api/map/territory-mask');
    expect(m.request.body).toEqual({ scale: 'departement', codes: ['13'] });
    http.verify();
  });
});
