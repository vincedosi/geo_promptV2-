import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ConfigService } from '../../../core/config/config.service';
import { ClusteringApi } from './clustering.api';

function preparer() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), ClusteringApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  return { api: TestBed.inject(ClusteringApi), http: TestBed.inject(HttpTestingController) };
}

describe('ClusteringApi', () => {
  it('clusters(60) : GET /api/poi-clusters?duration=60', () => {
    const { api, http } = preparer();
    api.clusters(60).subscribe();
    expect(http.expectOne('/api/poi-clusters?duration=60').request.method).toBe('GET');
    http.verify();
  });

  it('modeles() : GET /api/poi-clusters/models, la liste rendue telle quelle (vide si absente)', () => {
    const { api, http } = preparer();
    let lus: unknown;
    api.modeles().subscribe((m) => (lus = m));
    http.expectOne('/api/poi-clusters/models').flush({ models: [{ version: 3 }] });
    expect(lus).toEqual([{ version: 3 }]);
    api.modeles().subscribe((m) => (lus = m));
    http.expectOne('/api/poi-clusters/models').flush({});
    expect(lus).toEqual([]);
    http.verify();
  });

  it('modele(3), moyennesFrance(), profilsPoi, historique : les routes de React', () => {
    const { api, http } = preparer();
    api.modele(3).subscribe();
    api.moyennesFrance().subscribe();
    api.profilsPoi('a b').subscribe();
    api.historique('a b').subscribe();
    http.expectOne('/api/poi-clusters/models/3');
    http.expectOne('/api/poi-clusters/france-averages');
    http.expectOne('/api/poi-clusters/poi/a%20b');
    http.expectOne('/api/poi-clusters/history/a%20b');
    http.verify();
  });

  it('moyennesFrance : `averages` seules (404 « non calculées » → erreur de l’Observable)', () => {
    const { api, http } = preparer();
    let lu: unknown;
    api.moyennesFrance().subscribe((m) => (lu = m));
    http.expectOne('/api/poi-clusters/france-averages').flush({ averages: { pct_0_17: { avg: 0.2 } }, computed_at: 'x' });
    expect(lu).toEqual({ pct_0_17: { avg: 0.2 } });
    http.verify();
  });
});
