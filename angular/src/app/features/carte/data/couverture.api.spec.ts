import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ConfigService } from '../../../core/config/config.service';
import { CouvertureApi } from './couverture.api';

function preparer(apiBaseUrl: string) {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), CouvertureApi, { provide: ConfigService, useValue: { valeur: { apiBaseUrl } } }],
  });
  return { api: TestBed.inject(CouvertureApi), http: TestBed.inject(HttpTestingController) };
}

describe('CouvertureApi', () => {
  it('GET /api/zones/<id>/couverture?cible=&decoupage=, adresse construite sur baseUrl', () => {
    const { api, http } = preparer('');
    let rendu: unknown;
    api.couverture('0f8fad5b-d9cb-469f-a165-70867728950e', 'ind', 'cp').subscribe((r) => (rendu = r));
    const req = http.expectOne('/api/zones/0f8fad5b-d9cb-469f-a165-70867728950e/couverture?cible=ind&decoupage=cp');
    expect(req.request.method).toBe('GET');
    req.flush({ population: 1 });
    expect(rendu).toEqual({ population: 1 });
    http.verify();
  });
  it('sous le préfixe du shell : la base vient de HttpBaseService, l’id est encodé', () => {
    const { api, http } = preparer('https://hote.example/distant');
    api.couverture('a/b', 'ind_18_24', 'iris').subscribe();
    http.expectOne('https://hote.example/distant/api/zones/a%2Fb/couverture?cible=ind_18_24&decoupage=iris');
    http.verify();
  });
  it('croisements : GET /api/zones/<id>/croisements, id encodé, sur baseUrl', () => {
    const { api, http } = preparer('https://hote.example/distant');
    api.croisements('a/b').subscribe();
    expect(http.expectOne('https://hote.example/distant/api/zones/a%2Fb/croisements').request.method).toBe('GET');
    http.verify();
  });
  it('rayon : GET /api/analyses/couverture-rayon?<requête>, sur baseUrl', () => {
    const { api, http } = preparer('https://hote.example/distant');
    api.rayon('categorie=lycee&perimetre_type=departement&perimetre_code=13').subscribe();
    const req = http.expectOne('https://hote.example/distant/api/analyses/couverture-rayon?categorie=lycee&perimetre_type=departement&perimetre_code=13');
    expect(req.request.method).toBe('GET');
    http.verify();
  });
});
