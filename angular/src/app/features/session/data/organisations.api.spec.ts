import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../core/config/config.service';
import { OrganisationsApi } from './organisations.api';

function preparer() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), OrganisationsApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  return { api: TestBed.inject(OrganisationsApi), http: TestBed.inject(HttpTestingController) };
}

describe('OrganisationsApi', () => {
  it('lit GET /api/user/organizations', () => {
    const { api, http } = preparer();
    let lu: unknown;
    api.lister().subscribe((v) => (lu = v));
    const req = http.expectOne('/api/user/organizations');
    expect(req.request.method).toBe('GET');
    const reponse = { organizations: [], active_org_id: null, is_super_admin: true };
    req.flush(reponse);
    expect(lu).toEqual(reponse);
  });

  it('change d\'organisation par POST /api/user/switch-org, `null` compris (« toutes », super_admin)', () => {
    const { api, http } = preparer();
    api.changer('org-1').subscribe();
    const req = http.expectOne('/api/user/switch-org');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ organization_id: 'org-1' });
    req.flush({ success: true, organization_id: 'org-1' });

    api.changer(null).subscribe();
    expect(http.expectOne('/api/user/switch-org').request.body).toEqual({ organization_id: null });
  });
});
