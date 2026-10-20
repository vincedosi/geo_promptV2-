import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { CategoriesPoiApi } from './categories-poi.api';

function monter() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), CategoriesPoiApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  return { api: TestBed.inject(CategoriesPoiApi), http: TestBed.inject(HttpTestingController) };
}

describe('CategoriesPoiApi — GET / POST /api/admin/poi-categories (lot 6, T12)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('lecture : un GET sans paramètre', () => {
    const { api, http } = monter();
    api.lister().subscribe();
    const r = http.expectOne('/api/admin/poi-categories');
    expect(r.request.method).toBe('GET');
    expect(r.request.params.keys()).toEqual([]);
    r.flush({ success: true, categories: [] });
  });

  it('création : un POST JSON `{ categorie }` seul (`CategoryStep.tsx:50`)', () => {
    const { api, http } = monter();
    api.creer('[ESSAI lot 6]').subscribe();
    const r = http.expectOne('/api/admin/poi-categories');
    expect(r.request.method).toBe('POST');
    expect(r.request.body).toEqual({ categorie: '[ESSAI lot 6]' });
    r.flush({ success: true, categorie: 'essai_lot_6' });
  });
});
