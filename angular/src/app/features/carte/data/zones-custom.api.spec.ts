import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../core/config/config.service';
import { ZonesCustomApi } from './zones-custom.api';

function preparer() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), ZonesCustomApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  return { api: TestBed.inject(ZonesCustomApi), http: TestBed.inject(HttpTestingController) };
}

describe('ZonesCustomApi', () => {
  it('lister : GET /api/custom-geo/list avec les paramètres EXACTS de l\'appelant, dans leur ordre', () => {
    const { api, http } = preparer();
    let lu: unknown;
    api.lister(new URLSearchParams({ org_id: 'o1', _t: '42' })).subscribe((v) => (lu = v));
    const req = http.expectOne((r) => r.url.startsWith('/api/custom-geo/list'));
    expect(req.request.method).toBe('GET');
    expect(req.request.urlWithParams).toBe('/api/custom-geo/list?org_id=o1&_t=42');
    req.flush({ zones: [] });
    expect(lu).toEqual({ zones: [] });
    http.verify();
  });

  it('stats, géométrie, suppression : chemins et verbes de React', () => {
    const { api, http } = preparer();
    api.stats('o1', 7).subscribe();
    api.geometrie('z1').subscribe();
    api.supprimer('z1').subscribe();
    expect(http.expectOne('/api/custom-geo/stats?org_id=o1&_t=7').request.method).toBe('GET');
    expect(http.expectOne('/api/custom-geo/z1/geometry').request.method).toBe('GET');
    expect(http.expectOne('/api/custom-geo/z1').request.method).toBe('DELETE');
    http.verify();
  });

  it('opération booléenne : POST /api/custom-geo/source/<route> avec le corps tel quel', () => {
    const { api, http } = preparer();
    api.operation('difference', { zone_base: 'a', zones_retirees: ['b'] }).subscribe();
    const req = http.expectOne('/api/custom-geo/source/difference');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ zone_base: 'a', zones_retirees: ['b'] });
    http.verify();
  });

  it('enregistrer : POST /api/custom-geo/save, réponse COMPLÈTE (le 207 se lit sur le statut)', () => {
    const { api, http } = preparer();
    let statut = 0;
    api.enregistrer({ name: 'n', source_type: 'composite', source_metadata: {}, geometry: { type: 'Point', coordinates: [0, 0] }, org_id: 'o' })
      .subscribe((r) => (statut = r.status));
    http.expectOne('/api/custom-geo/save').flush({ zone_id: 'z', warning: 'zone_created_but_resolution_failed' }, { status: 207, statusText: 'Multi-Status' });
    expect(statut).toBe(207);
    http.verify();
  });

  it('exporter : GET …/export?format=… en blob, réponse complète', () => {
    const { api, http } = preparer();
    api.exporter('z1', 'bidding_script').subscribe();
    const req = http.expectOne('/api/custom-geo/z1/export?format=bidding_script');
    expect(req.request.responseType).toBe('blob');
    http.verify();
  });

  it('exporter pondéré : les paramètres du plan média suivent le format, dans l’ordre de React', () => {
    const { api, http } = preparer();
    api.exporter('z1', 'tiktok_geo', { weights: '{"p1":75}', budget: '10000' }).subscribe();
    http.expectOne('/api/custom-geo/z1/export?format=tiktok_geo&weights=%7B%22p1%22%3A75%7D&budget=10000');
    http.verify();
  });

  it('plan média (T15) : totaux nationaux, audience par item, détail de zone', () => {
    const { api, http } = preparer();
    api.totauxNationaux().subscribe();
    api.audienceItems('z1').subscribe();
    api.zone('z1').subscribe();
    expect(http.expectOne('/api/custom-geo/national-totals').request.method).toBe('GET');
    expect(http.expectOne('/api/custom-geo/z1/items-audience').request.method).toBe('GET');
    expect(http.expectOne('/api/custom-geo/z1').request.method).toBe('GET');
    http.verify();
  });

  it('plan média (T15) : campagnes, plan d’une campagne, enregistrement, détachement, instantané', () => {
    const { api, http } = preparer();
    api.campagnesPlan().subscribe();
    api.planMedia('c1').subscribe();
    api.enregistrerPlan({ campaign_id: 'c1', plan: { zones: [], budget: null, cpm: null, cible: 'total', weights: {} } }).subscribe();
    api.detacherPlan('c1').subscribe();
    const corps = { campaign_id: 'c1', dsp: 'dv360', budget: null, cpm: null, cible: 'total' as const, zones: [] };
    api.instantane(corps).subscribe();
    expect(http.expectOne((r) => r.urlWithParams === '/api/custom-geo/media-plan' && r.method === 'GET')).toBeTruthy();
    expect(http.expectOne((r) => r.urlWithParams === '/api/custom-geo/media-plan?campaign_id=c1' && r.method === 'GET')).toBeTruthy();
    const post = http.expectOne((r) => r.urlWithParams === '/api/custom-geo/media-plan' && r.method === 'POST');
    expect(post.request.body).toEqual({ campaign_id: 'c1', plan: { zones: [], budget: null, cpm: null, cible: 'total', weights: {} } });
    expect(http.expectOne((r) => r.method === 'DELETE').request.urlWithParams).toBe('/api/custom-geo/media-plan?campaign_id=c1');
    const snap = http.expectOne('/api/custom-geo/media-plan/snapshot');
    expect(snap.request.method).toBe('POST');
    expect(snap.request.body).toEqual(corps);
    http.verify();
  });

  // ── Créer une zone (T16) ─────────────────────────────────────────────────────────────────────────────────────────────

  it('codes postaux collés : POST JSON { saisie } vers /source/codes-postaux', () => {
    const { api, http } = preparer();
    api.depuisCodesPostaux('13001, 13002, 99999, abc').subscribe();
    const req = http.expectOne('/api/custom-geo/source/codes-postaux');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ saisie: '13001, 13002, 99999, abc' });
    http.verify();
  });

  it('fichier déposé : multipart, champ `file` (celui que lit `fichierDeFormulaire`), Content-Type laissé au navigateur', () => {
    const { api, http } = preparer();
    const fichier = new File(['13001\n13002'], 'liste.csv', { type: 'text/csv' });
    api.depuisCodesPostaux(fichier).subscribe();
    const req = http.expectOne('/api/custom-geo/source/codes-postaux');
    expect(req.request.body).toBeInstanceOf(FormData);
    expect((req.request.body as FormData).get('file')).toBe(fichier);
    // Fixer Content-Type à la main perdrait la frontière multipart : la route ne lirait aucun fichier.
    expect(req.request.headers.has('Content-Type')).toBe(false);
    http.verify();
  });

  it('rayon, dessin, capture et sources de couche : chemins et corps tels quels', () => {
    const { api, http } = preparer();
    const trace: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    api.depuisRayon({ lon: 5.37, lat: 43.3, rayon_m: 20000 }).subscribe();
    api.depuisDessin(trace).subscribe();
    api.capturer({ name: 'n' }).subscribe();
    api.source('carreaux', { bbox: [1, 2, 3, 4] }).subscribe();
    expect(http.expectOne('/api/custom-geo/source/rayon').request.body).toEqual({ lon: 5.37, lat: 43.3, rayon_m: 20000 });
    expect(http.expectOne('/api/custom-geo/source/dessin').request.body).toEqual({ geometry: trace });
    const capture = http.expectOne('/api/custom-geo/capture');
    expect(capture.request.method).toBe('POST');
    expect(capture.request.body).toEqual({ name: 'n' });
    expect(http.expectOne('/api/custom-geo/source/carreaux').request.body).toEqual({ bbox: [1, 2, 3, 4] });
    http.verify();
  });
});
