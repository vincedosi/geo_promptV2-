import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ConfigService } from '../../../core/config/config.service';
import { JeuxApi } from './jeux.api';

const Z = '0f8fad5b-d9cb-469f-a165-70867728950e';
const J = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const BASE = 'https://hote.example/distant';

function preparer(apiBaseUrl = BASE) {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), JeuxApi, { provide: ConfigService, useValue: { valeur: { apiBaseUrl } } }],
  });
  return { api: TestBed.inject(JeuxApi), http: TestBed.inject(HttpTestingController) };
}

describe('JeuxApi — adresses sur HttpBaseService.baseUrl, jamais écrites en dur', () => {
  it('plateformes : GET /api/zones/plateformes', () => {
    const { api, http } = preparer();
    let rendu: unknown;
    api.plateformes().subscribe((r) => (rendu = r));
    const req = http.expectOne(`${BASE}/api/zones/plateformes`);
    expect(req.request.method).toBe('GET');
    req.flush({ plateformes: [] });
    expect(rendu).toEqual({ plateformes: [] });
    http.verify();
  });
  it('lister, lire, supprimer : /api/zones/jeux[/id], id encodé', () => {
    const { api, http } = preparer('');
    api.lister().subscribe();
    expect(http.expectOne('/api/zones/jeux').request.method).toBe('GET');
    api.lire('a/b').subscribe();
    expect(http.expectOne('/api/zones/jeux/a%2Fb').request.method).toBe('GET');
    api.supprimer(J).subscribe();
    expect(http.expectOne(`/api/zones/jeux/${J}`).request.method).toBe('DELETE');
    http.verify();
  });
  it('enregistrer : POST /api/zones/jeux, corps tel quel (jeu de type zone)', () => {
    const { api, http } = preparer();
    const corps = {
      nom: 'Lycées BdR', jeu: { type: 'zone' as const, zone_id: Z, cible: 'ind', mode_plan: 'pondere' as const,
        plateformes: [{ plateforme: 'meta' as const, maille: 'cercle' as const, seuil: 20, rayon_m: 10_000 }] },
    };
    api.enregistrer(corps).subscribe();
    const req = http.expectOne(`${BASE}/api/zones/jeux`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(corps);
    http.verify();
  });
  it('régler : PATCH /api/zones/jeux/<id>', () => {
    const { api, http } = preparer();
    api.regler(J, { nom: 'Renommé', plateformes: [{ plateforme: 'dv360', maille: 'cp', seuil: 35 }] }).subscribe();
    const req = http.expectOne(`${BASE}/api/zones/jeux/${J}`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ nom: 'Renommé', plateformes: [{ plateforme: 'dv360', maille: 'cp', seuil: 35 }] });
    http.verify();
  });
  it('cercles : GET /api/zones/<id>/cercles?cible=&rayon=&seuil=&plateforme=', () => {
    const { api, http } = preparer();
    api.cercles('a/b', { cible: 'ind_18_24', rayon: 10_000, seuil: 12.5, plateforme: 'meta' }).subscribe();
    const req = http.expectOne(`${BASE}/api/zones/a%2Fb/cercles?cible=ind_18_24&rayon=10000&seuil=12.5&plateforme=meta`);
    expect(req.request.method).toBe('GET');
    http.verify();
  });
  it('contours des communes : POST /api/zones/communes/contours { codes }', () => {
    const { api, http } = preparer();
    api.contoursCommunes(['13001', '2A004']).subscribe();
    const req = http.expectOne(`${BASE}/api/zones/communes/contours`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ codes: ['13001', '2A004'] });
    http.verify();
  });
  it('extractions : GET, puis POST { origine, commentaire } — recalage ou initiale', () => {
    const { api, http } = preparer();
    api.extractions(J).subscribe();
    expect(http.expectOne(`${BASE}/api/zones/jeux/${J}/extractions`).request.method).toBe('GET');
    api.extraire(J, { commentaire: 'v1', recalage: false }).subscribe();
    const initiale = http.expectOne(`${BASE}/api/zones/jeux/${J}/extractions`);
    expect([initiale.request.method, initiale.request.body]).toEqual(['POST', { origine: 'initiale', commentaire: 'v1' }]);
    api.extraire(J, { commentaire: '', recalage: true }).subscribe();
    expect(http.expectOne(`${BASE}/api/zones/jeux/${J}/extractions`).request.body).toEqual({ origine: 'recalage', commentaire: '' });
    http.verify();
  });
});
