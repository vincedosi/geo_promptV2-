import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../core/config/config.service';
import { ProfilRisqueApi } from './profil-risque.api';

function preparer() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), ProfilRisqueApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  return { api: TestBed.inject(ProfilRisqueApi), http: TestBed.inject(HttpTestingController) };
}

describe('ProfilRisqueApi', () => {
  it('bandes : profil, cible, maille toujours ; parent, region, natures seulement si renseignés', () => {
    const { api, http } = preparer();
    api.bandes({ profil: 'p', cible: 'ind', maille: 'departement', parent: null, region: null, natures: [] }).subscribe();
    const r1 = http.expectOne((r) => r.url === '/api/risques/profil/bandes');
    expect(r1.request.params.keys()).toEqual(['profil', 'cible', 'maille']);
    r1.flush({});

    api.bandes({ profil: 'p', cible: 'ind', maille: 'commune', parent: '13', region: '93', natures: ['Toxicité aiguë', 'GPL'] }).subscribe();
    const r2 = http.expectOne((r) => r.url === '/api/risques/profil/bandes');
    expect(r2.request.params.keys()).toEqual(['profil', 'cible', 'maille', 'parent', 'region', 'natures']);
    expect(r2.request.params.get('natures')).toBe('Toxicité aiguë,GPL');
    expect(r2.request.method).toBe('GET');
    r2.flush({});
  });

  it('cibles : GET /api/risques/exposition/cibles', () => {
    const { api, http } = preparer();
    let lu: unknown;
    api.cibles().subscribe((v) => (lu = v));
    http.expectOne('/api/risques/exposition/cibles').flush({ cibles: [{ code: 'ind', libelle: 'Population', famille: 'pop' }] });
    expect(lu).toEqual({ cibles: [{ code: 'ind', libelle: 'Population', famille: 'pop' }] });
  });

  it('exportProfil : paramètres repris tels quels, espace en %20 (jamais +), réponse complète en blob', () => {
    const { api, http } = preparer();
    const q = new URLSearchParams({ profil: 'p', cible: 'ind', maille: 'departement', libelle_cible: 'Population totale' });
    let rep: { headers: { get(n: string): string | null } } | undefined;
    api.exportProfil(q).subscribe((v) => (rep = v));
    const req = http.expectOne((r) => r.url === '/api/risques/profil/export');
    expect(req.request.responseType).toBe('blob');
    expect(req.request.params.get('libelle_cible')).toBe('Population totale');
    expect(req.request.urlWithParams).toContain('libelle_cible=Population%20totale');
    expect(req.request.urlWithParams).not.toContain('%2B');
    req.flush(new Blob(['x']), { headers: { 'content-disposition': 'attachment; filename="a.xlsx"' } });
    expect(rep?.headers.get('content-disposition')).toContain('a.xlsx');
  });

  it("exportProfil : un « + » littéral d'une valeur part en %2B, jamais lu comme un espace", () => {
    const { api, http } = preparer();
    const q = new URLSearchParams({ profil: 'p', cible: 'ind', maille: 'departement', libelle_cible: '0-3 ans + 65 ans' });
    api.exportProfil(q).subscribe();
    const req = http.expectOne((r) => r.url === '/api/risques/profil/export');
    expect(req.request.params.get('libelle_cible')).toBe('0-3 ans + 65 ans');
    expect(req.request.urlWithParams).toContain('libelle_cible=0-3%20ans%20%2B%2065%20ans');
    req.flush(new Blob(['x']));
  });

  it('exportRayon : GET /api/risques/exposition/rayon/export?…', () => {
    const { api, http } = preparer();
    api.exportRayon(new URLSearchParams({ rayon_m: '5000', gravites: 'seveso_haut' })).subscribe();
    const req = http.expectOne('/api/risques/exposition/rayon/export?rayon_m=5000&gravites=seveso_haut');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['x']));
  });
});
