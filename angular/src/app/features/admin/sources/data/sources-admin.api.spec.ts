import { TestBed } from '@angular/core/testing';
import { HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { nomDeFichier } from '../../../../core/http/telecharger';
import { RadioAdminApi } from '../../radio/data/radio-admin.api';
import { SourcesAdminApi } from './sources-admin.api';

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
});
