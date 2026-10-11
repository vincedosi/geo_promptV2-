import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ConfigService } from '../../../core/config/config.service';
import { AnalysesApi } from './analyses.api';

function monter() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), AnalysesApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  return { api: TestBed.inject(AnalysesApi), http: TestBed.inject(HttpTestingController) };
}

describe('AnalysesApi', () => {
  it('les huit routes, méthodes et corps de React', () => {
    const { api, http } = monter();
    api.indicateurs().subscribe();
    api.campagnes().subscribe();
    api.score({ indicateurs: [{ code: 'a', poids: 1, sens: 'croissant' }], perimetre: { type: 'france', code: 'france' }, enregistrer: false, nom: 'n' }).subscribe();
    api.correlation('c1', 'rev_median').subscribe();
    api.zoneDepuisScore({ indicateurs: [], codes_postaux: ['13001'], seuil: 70 }).subscribe();
    api.lister().subscribe();
    api.rejouer('id-1').subscribe();
    api.supprimer('id-1').subscribe();
    const attendus: Array<[string, string]> = [
      ['GET', '/api/cibles/indicators'],
      ['GET', '/api/digital/campaigns'],
      ['POST', '/api/analyses/score'],
      ['GET', '/api/analyses/correlation?campaignId=c1&variable=rev_median'],
      ['POST', '/api/custom-geo/source/score'],
      ['GET', '/api/analyses'],
      ['POST', '/api/analyses/id-1/rejouer'],
      ['DELETE', '/api/analyses/id-1'],
    ];
    for (const [methode, url] of attendus) {
      const req = http.expectOne((r) => r.urlWithParams.endsWith(url) && r.method === methode);
      if (url.endsWith('/rejouer')) expect(req.request.body).toEqual({});
      if (url === '/api/analyses/score') expect(req.request.body.perimetre).toEqual({ type: 'france', code: 'france' });
    }
    http.verify();
  });
});
