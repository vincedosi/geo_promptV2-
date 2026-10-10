import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ConfigService } from '../../../core/config/config.service';
import { RadioApi, type RequeteEmetteurs, parametresEmetteurs } from './radio.api';

function preparer() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), RadioApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  return { api: TestBed.inject(RadioApi), http: TestBed.inject(HttpTestingController) };
}

const base: RequeteEmetteurs = {
  radioId: null, couverture: false, bbox: [5.123456, 43.2, 5.5, 43.45678], systeme: '', radioIds: [], categoriesExclues: [],
};

describe('parametresEmetteurs (useRadioLayer.ts:84-103)', () => {
  it('par défaut : la carte VISIBLE, à 4 décimales, encodée comme URLSearchParams', () => {
    expect(parametresEmetteurs(base)).toBe('bbox=5.1235%2C43.2000%2C5.5000%2C43.4568');
  });

  it('couverture : lecture globale plafonnée, sans bbox', () => {
    expect(parametresEmetteurs({ ...base, couverture: true })).toBe('limit=15000');
  });

  it('une radio choisie l’emporte sur tout, sans bbox ni plafond ; filtres ajoutés dans l’ordre de React', () => {
    expect(parametresEmetteurs({
      ...base, radioId: 'r1', couverture: true, systeme: 'DAB+', radioIds: ['a', 'b'], categoriesExclues: ['D', 'E'],
    })).toBe('radio_id=r1&systeme=DAB%2B&radio_ids=a%2Cb&exclude_categories=D%2CE');
  });
});

describe('RadioApi', () => {
  it('emetteurs : GET /api/radio/emetteurs avec la chaîne de React', () => {
    const { api, http } = preparer();
    api.emetteurs({ ...base, couverture: true }).subscribe();
    expect(http.expectOne('/api/radio/emetteurs?limit=15000').request.method).toBe('GET');
    http.verify();
  });

  it('optionsFiltre : GET /api/radio/filter-options', () => {
    const { api, http } = preparer();
    api.optionsFiltre().subscribe();
    http.expectOne('/api/radio/filter-options');
    http.verify();
  });

  it('stations : ?search= encodé, 8 au plus', () => {
    const { api, http } = preparer();
    api.stations('Fun & co').subscribe();
    http.expectOne('/api/radio/stations?search=Fun%20%26%20co&limit=8');
    http.verify();
  });
});
