import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { ImportGeoApi, type LigneCarreau, type ReponseLot } from './import-geo.api';

function monter() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), ImportGeoApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  return { api: TestBed.inject(ImportGeoApi), http: TestBed.inject(HttpTestingController) };
}

const LIGNE: LigneCarreau = {
  idcar: 'ESSAI_LOT6_0001', resolution: '200m', millesime: '2021',
  geom_wkt: 'SRID=4326;POLYGON((2.3 48.8,2.3 48.9,2.4 48.9,2.3 48.8))', metadata: { ind: 10 },
};

describe('ImportGeoApi — routes app/api/admin/import-geo/** (lot 6, T14)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('lot : POST JSON `{ rows }`, réponse rendue telle quelle', () => {
    const { api, http } = monter();
    let r: ReponseLot | undefined;
    api.envoyerLot([LIGNE]).subscribe((x) => (r = x));
    const req = http.expectOne('/api/admin/import-geo');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ rows: [LIGNE] });
    req.flush({ success: true, inserted: 1 });
    expect(r).toEqual({ success: true, inserted: 1 });
  });

  it('refus à corps JSON (400, 500) : RENDU comme une réponse, comme `res.json()` de React — jamais levé', () => {
    const { api, http } = monter();
    let r: ReponseLot | undefined;
    api.envoyerLot([LIGNE]).subscribe({ next: (x) => (r = x), error: () => (r = undefined) });
    http.expectOne('/api/admin/import-geo').flush({ success: false, error: 'batch trop gros (max 2000)' }, { status: 400, statusText: 'Bad Request' });
    expect(r).toEqual({ success: false, error: 'batch trop gros (max 2000)' });
  });

  it('413 à corps HTML (proxy) : `{ success: false, error: "HTTP 413 — payload too large" }`, qui déclenche la reprise par demi-lots', () => {
    const { api, http } = monter();
    let r: ReponseLot | undefined;
    api.envoyerLot([LIGNE]).subscribe((x) => (r = x));
    http.expectOne('/api/admin/import-geo').flush('<html>413</html>', { status: 413, statusText: 'Payload Too Large' });
    expect(r).toEqual({ success: false, error: 'HTTP 413 — payload too large' });
  });

  it('corps illisible : lève « HTTP <statut> » ; aucune réponse : « Failed to fetch » (le message de `fetch`)', () => {
    const { api, http } = monter();
    const erreurs: string[] = [];
    api.envoyerLot([LIGNE]).subscribe({ error: (e: Error) => erreurs.push(e.message) });
    http.expectOne('/api/admin/import-geo').flush('<html>502</html>', { status: 502, statusText: 'Bad Gateway' });
    api.envoyerLot([LIGNE]).subscribe({ error: (e: Error) => erreurs.push(e.message) });
    http.expectOne('/api/admin/import-geo').error(new ProgressEvent('error'), { status: 0, statusText: '' });
    expect(erreurs).toEqual(['HTTP 502', 'Failed to fetch']);
  });

  it('enregistrement : POST JSON au corps de React, `source_id` rendu ; refus JSON rendu', () => {
    const { api, http } = monter();
    const corps = {
      name: 'Carreaux 200m — 2021 (carreaux-essai)', resolution: '200m', millesime: '2021',
      row_count: 50, columns: ['idcar_200m'], filename: 'carreaux-essai',
    };
    const recus: unknown[] = [];
    api.enregistrer(corps).subscribe((x) => recus.push(x));
    const req = http.expectOne('/api/admin/import-geo/register');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(corps);
    req.flush({ success: true, source_id: 'abc' });
    api.enregistrer(corps).subscribe((x) => recus.push(x));
    http.expectOne('/api/admin/import-geo/register').flush({ success: false, error: 'non' }, { status: 500, statusText: 'Erreur' });
    expect(recus).toEqual([{ success: true, source_id: 'abc' }, { success: false, error: 'non' }]);
  });
});
