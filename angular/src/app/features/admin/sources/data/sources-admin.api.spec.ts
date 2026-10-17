import { TestBed } from '@angular/core/testing';
import { HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { nomDeFichier } from '../../../../core/http/telecharger';
import { RadioAdminApi } from '../../radio/data/radio-admin.api';
import { FLUX_IMPORT_DSP } from '../testing/dsp-import.fixture';
import { SourcesAdminApi, type EvenementImportDsp } from './sources-admin.api';

function monter() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), SourcesAdminApi, RadioAdminApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  return { api: TestBed.inject(SourcesAdminApi), radio: TestBed.inject(RadioAdminApi), http: TestBed.inject(HttpTestingController) };
}

describe('SourcesAdminApi — routes de l’écran Sources (lot 6, T18)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('lectures : sources, statistiques, zones perso, radio — GET sans paramètre, aux adresses de React', () => {
    const { api, radio, http } = monter();
    api.sources().subscribe();
    api.stats().subscribe();
    api.statsZones().subscribe();
    radio.stats().subscribe();
    for (const url of ['/api/admin/sources', '/api/admin/sources-stats', '/api/admin/custom-geo/stats', '/api/radio/stats']) {
      const r = http.expectOne(url);
      expect(r.request.method).toBe('GET');
      expect(r.request.params.keys()).toEqual([]);
      r.flush({});
    }
  });

  it('écritures : PATCH au corps exact (nom, ou champs filtres), DELETE, clés metadata ; identifiant encodé', () => {
    const { api, http } = monter();
    api.modifier('a b', { name: 'Nouveau' }).subscribe();
    const p = http.expectOne('/api/admin/sources/a%20b');
    expect(p.request.method).toBe('PATCH');
    expect(p.request.body).toEqual({ name: 'Nouveau' });
    p.flush({ success: true });
    api.modifier('s1', { filter_fields: ['ville'] }).subscribe();
    expect(http.expectOne('/api/admin/sources/s1').request.body).toEqual({ filter_fields: ['ville'] });
    api.supprimer('s1').subscribe();
    expect(http.expectOne((r) => r.method === 'DELETE').request.url).toBe('/api/admin/sources/s1');
    api.cles('s1').subscribe();
    expect(http.expectOne('/api/admin/sources/s1/meta-keys').request.method).toBe('GET');
  });

  it('export (C8) : GET en blob, réponse ENTIÈRE (en-têtes lus pour le nom de fichier)', () => {
    const { api, http } = monter();
    let nom = '';
    api.exporter('s1').subscribe((r) => (nom = nomDeFichier(r, 'repli.csv')));
    const r = http.expectOne('/api/admin/sources/s1/export');
    expect(r.request.responseType).toBe('blob');
    r.flush(new Blob(['nom;categorie\n']), {
      headers: new HttpHeaders({ 'Content-Disposition': 'attachment; filename="CIRFA_export.csv"' }),
    });
    expect(nom).toBe('CIRFA_export.csv');
  });

  it('campagnes DSP : GET sans paramètre (le `?_t=` anti-cache de React est sans objet sous HttpClient) ; DELETE à l’identifiant encodé', () => {
    const { api, http } = monter();
    api.campagnes().subscribe();
    const g = http.expectOne('/api/admin/campaigns');
    expect(g.request.method).toBe('GET');
    expect(g.request.params.keys()).toEqual([]);
    g.flush([]);
    api.supprimerCampagne('c 1').subscribe();
    const d = http.expectOne('/api/admin/campaigns/c%201');
    expect(d.request.method).toBe('DELETE');
    d.flush({ success: true, deleted: 1 });
  });

  it('import DSP : POST multipart aux trois champs de React (nom rogné), flux SSE en texte, événements dans l’ordre', () => {
    const { api, http } = monter();
    const fichier = new File(['campaign,date\n'], 'campagne-essai.csv', { type: 'text/csv' });
    const recus: EvenementImportDsp[] = [];
    api.importerCampagne({ fichier, source: 'adform', nom: '  [ESSAI lot 6] campagne  ' }).subscribe((e) => recus.push(e));
    const r = http.expectOne('/api/admin/campaigns/import');
    expect(r.request.method).toBe('POST');
    expect(r.request.responseType).toBe('text');
    expect(r.request.reportProgress).toBe(true);
    const corps = r.request.body as FormData;
    expect([...corps.keys()]).toEqual(['file', 'dsp_source', 'campaign_name']);
    expect(corps.get('file')).toBe(fichier);
    expect(corps.get('dsp_source')).toBe('adform');
    expect(corps.get('campaign_name')).toBe('[ESSAI lot 6] campagne');
    r.flush(FLUX_IMPORT_DSP);
    expect(recus.map((e) => e.type)).toEqual(['parsing', 'progress', 'progress', 'matching', 'matching', 'rollups', 'complete']);
  });

  it('import DSP sans nom (ou blanc) : pas de champ `campaign_name`, comme React (`if (dspCampaignName.trim())`)', () => {
    const { api, http } = monter();
    api.importerCampagne({ fichier: new File(['x'], 'a.csv'), source: 'ttd', nom: '   ' }).subscribe();
    const r = http.expectOne('/api/admin/campaigns/import');
    expect([...(r.request.body as FormData).keys()]).toEqual(['file', 'dsp_source']);
    r.flush('');
  });

  it('zones perso : chaque filtre seulement s’il est renseigné (`org_id`, `source_type`, `q`) ; DELETE encodé', () => {
    const { api, http } = monter();
    api.zones({ orgId: null, sourceType: null, recherche: '' }).subscribe();
    const a = http.expectOne((r) => r.url === '/api/admin/custom-geo/list');
    expect(a.request.params.keys()).toEqual([]);
    a.flush({ zones: [] });
    api.zones({ orgId: 'o1', sourceType: 'composite', recherche: 'cible' }).subscribe();
    const b = http.expectOne((r) => r.url === '/api/admin/custom-geo/list');
    expect(b.request.urlWithParams).toBe('/api/admin/custom-geo/list?org_id=o1&source_type=composite&q=cible');
    b.flush({ zones: [] });
    api.supprimerZone('z 1').subscribe();
    const d = http.expectOne('/api/admin/custom-geo/z%201');
    expect(d.request.method).toBe('DELETE');
    d.flush({ deleted: true, id: 'z 1' });
  });
});
