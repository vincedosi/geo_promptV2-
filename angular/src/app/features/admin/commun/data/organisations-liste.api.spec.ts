import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { OrganisationsListeApi, type ReponseOrganisationsListe } from './organisations-liste.api';

describe('OrganisationsListeApi — GET /api/admin/organizations (lot 6, T20, amendement A2)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('un GET sans paramètre à l’adresse de React (`WorkspaceFilter.tsx:20`), réponse rendue telle quelle', () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), OrganisationsListeApi,
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    let recu: ReponseOrganisationsListe | null = null;
    TestBed.inject(OrganisationsListeApi).lister().subscribe((r) => (recu = r));
    const r = TestBed.inject(HttpTestingController).expectOne('/api/admin/organizations');
    expect(r.request.method).toBe('GET');
    expect(r.request.params.keys()).toEqual([]);
    const corps = { success: true, organizations: [{ id: 'o1', name: 'Espace A' }] };
    r.flush(corps);
    expect(recu).toEqual(corps);
  });
});
