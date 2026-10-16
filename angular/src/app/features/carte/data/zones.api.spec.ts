import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../core/config/config.service';
import { ZonesApi } from './zones.api';

function preparer() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), ZonesApi, { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } }],
  });
  return { api: TestBed.inject(ZonesApi), http: TestBed.inject(HttpTestingController) };
}

describe('ZonesApi', () => {
  it('aperçu, écriture (réponse complète), recalcul (id encodé)', () => {
    const { api, http } = preparer();
    const recette = { v: 1, type: 'dessin' } as const;
    let statut = 0;
    api.apercu({ recette }).subscribe();
    api.enregistrer({ nom: 'Z', recette }).subscribe((r) => (statut = r.status));
    api.recalculer('a/b').subscribe();
    const a = http.expectOne('/api/zones/apercu');
    expect([a.request.method, a.request.body]).toEqual(['POST', { recette }]);
    const e = http.expectOne('/api/zones');
    expect(e.request.body).toEqual({ nom: 'Z', recette });
    e.flush({ zone_id: 'z' }, { status: 207, statusText: 'Multi-Status' });
    expect(statut).toBe(207);
    expect(http.expectOne('/api/zones/a%2Fb/recalculer').request.method).toBe('POST');
    http.verify();
  });
});
