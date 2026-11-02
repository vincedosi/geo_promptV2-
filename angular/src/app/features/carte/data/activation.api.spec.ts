import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ConfigService } from '../../../core/config/config.service';
import { ActivationApi, type LigneFlux } from './activation.api';

const C = '0f8fad5b-d9cb-469f-a165-70867728950e';
const J = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const BASE = 'https://hote.example/distant';

function preparer() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), ActivationApi, { provide: ConfigService, useValue: { valeur: { apiBaseUrl: BASE } } }],
  });
  return { api: TestBed.inject(ActivationApi), http: TestBed.inject(HttpTestingController) };
}

describe('ActivationApi — les routes de ⑦ sur HttpBaseService.baseUrl', () => {
  it('pré-vol, historique, annulation (confirmée), publication', () => {
    const { api, http } = preparer();
    api.prevol(C).subscribe();
    expect(http.expectOne(`${BASE}/api/campaigns/${C}/activation/prevol`).request.method).toBe('GET');
    api.historique(C).subscribe();
    expect(http.expectOne(`${BASE}/api/campaigns/${C}/activation/historique`).request.method).toBe('GET');
    api.annuler(C, 'l1').subscribe();
    const r = http.expectOne(`${BASE}/api/campaigns/${C}/activation/rollback`);
    expect([r.request.method, r.request.body]).toEqual(['POST', { lot_id: 'l1', confirme: true }]);
    api.publier('s1').subscribe();
    const p = http.expectOne(`${BASE}/api/bidding/strategies/s1/publier`);
    expect([p.request.method, p.request.body]).toEqual(['POST', {}]);
    http.verify();
  });

  it('pousser : le corps de la route, et le flux NDJSON lu ligne à ligne', () => {
    const { api, http } = preparer();
    const lignes: LigneFlux[] = [];
    let fini = false;
    const corps = { canal: 'dv360' as const, advertiser_id: '12', cibles: [{ line_item_id: '3' }] };
    api.pousser(C, corps).subscribe({ next: (l) => lignes.push(l), complete: () => { fini = true; } });
    const req = http.expectOne(`${BASE}/api/campaigns/${C}/activation/pousser`);
    expect([req.request.method, req.request.body, req.request.responseType]).toEqual(['POST', corps, 'text']);
    const debut = '{"etape":"debut","total":1}\n';
    req.event({ type: HttpEventType.DownloadProgress, loaded: 1, partialText: `${debut}{"etape":"ci` });
    expect(lignes).toEqual([{ etape: 'debut', total: 1 }]);
    const tout = `${debut}{"etape":"cible","n":1,"statut":"pousse"}\n{"etape":"fin","pousses":1,"echecs":0}\n`;
    req.flush(tout);
    expect(lignes.map((l) => l.etape)).toEqual(['debut', 'cible', 'fin']);
    expect(fini).toBe(true);
  });

  it('fichier : l’adresse de la route, en blob', () => {
    const { api, http } = preparer();
    expect(api.urlFichier(J, 2, 'dv360', 'sdf')).toBe(`${BASE}/api/zones/jeux/${J}/extractions/2/fichier?plateforme=dv360&format=sdf`);
    api.fichier(J, 2, 'meta', 'cercles').subscribe();
    const r = http.expectOne(`${BASE}/api/zones/jeux/${J}/extractions/2/fichier?plateforme=meta&format=cercles`);
    expect(r.request.responseType).toBe('blob');
    // B14 round 1 (I-2) : un bloc du découpage.
    expect(api.urlFichier(J, 2, 'tiktok', 'territoires', 2)).toBe(`${BASE}/api/zones/jeux/${J}/extractions/2/fichier?plateforme=tiktok&format=territoires&bloc=2`);
  });
});
