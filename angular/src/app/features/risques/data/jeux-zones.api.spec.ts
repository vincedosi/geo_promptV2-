import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../core/config/config.service';
import { JEU_DEFAUT } from '../logique/jeu';
import { JeuxZonesApi } from './jeux-zones.api';

function preparer() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), JeuxZonesApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  return { api: TestBed.inject(JeuxZonesApi), http: TestBed.inject(HttpTestingController) };
}

describe('JeuxZonesApi', () => {
  it('lister : GET /api/zones/jeux', () => {
    const { api, http } = preparer();
    let lu: unknown;
    api.lister().subscribe((v) => (lu = v));
    http.expectOne('/api/zones/jeux').flush({ jeux: [] });
    expect(lu).toEqual({ jeux: [] });
  });

  it('lire : GET /api/zones/jeux/:id', () => {
    const { api, http } = preparer();
    api.lire('abc').subscribe();
    const req = http.expectOne('/api/zones/jeux/abc');
    expect(req.request.method).toBe('GET');
    req.flush({ jeu: {}, classes: [] });
  });

  it('construire : POST { jeu, brouillon: true }', () => {
    const { api, http } = preparer();
    let lu: unknown;
    api.construire(JEU_DEFAUT).subscribe((v) => (lu = v));
    const req = http.expectOne('/api/zones/jeux');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ jeu: JEU_DEFAUT, brouillon: true });
    req.flush({ id: 'nouveau' });
    expect(lu).toEqual({ id: 'nouveau' });
  });

  it('regler : PATCH avec les champs tels quels', () => {
    const { api, http } = preparer();
    api.regler('abc', { seuil_couverture_cp: 35, enregistrer: true, nom: 'Seveso' }).subscribe();
    const req = http.expectOne('/api/zones/jeux/abc');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ seuil_couverture_cp: 35, enregistrer: true, nom: 'Seveso' });
    req.flush({});
  });

  it('supprimer : DELETE', () => {
    const { api, http } = preparer();
    api.supprimer('abc').subscribe();
    const req = http.expectOne('/api/zones/jeux/abc');
    expect(req.request.method).toBe('DELETE');
    req.flush({});
  });

  it('cpGeo, grappes, extractions : GET', () => {
    const { api, http } = preparer();
    api.cpGeo('abc', '1.0000,2.0000,3.0000,4.0000').subscribe();
    const a = http.expectOne('/api/zones/jeux/abc/cp-geo?bbox=1.0000,2.0000,3.0000,4.0000');
    expect(a.request.method).toBe('GET');
    a.flush({ type: 'FeatureCollection', features: [], n_total: 0, n_affiches: 0, n_retenus: 0, taux_utile: null });
    api.grappes('abc').subscribe();
    http.expectOne('/api/zones/jeux/abc/grappes').flush({ grappes: [] });
    api.extractions('abc').subscribe();
    http.expectOne('/api/zones/jeux/abc/extractions').flush({ extractions: [] });
  });

  it('extraire : POST { origine, commentaire }', () => {
    const { api, http } = preparer();
    api.extraire('abc', { origine: 'initiale', commentaire: 'v1 envoyée' }).subscribe();
    const req = http.expectOne('/api/zones/jeux/abc/extractions');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ origine: 'initiale', commentaire: 'v1 envoyée' });
    req.flush({ version: 1 });
  });

  it('exportJeu et exportExtraction : blob, réponse complète', () => {
    const { api, http } = preparer();
    api.exportJeu('abc').subscribe();
    const a = http.expectOne('/api/zones/jeux/abc/export');
    expect(a.request.responseType).toBe('blob');
    a.flush(new Blob(['x']));
    api.exportExtraction('abc', 3).subscribe();
    const b = http.expectOne('/api/zones/jeux/abc/extractions/3/export');
    expect(b.request.responseType).toBe('blob');
    b.flush(new Blob(['x']));
  });
});
