import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../core/config/config.service';
import { CARREAUX_TILE_VERSION } from '../logique/versions';
import { CarreauxApi } from './carreaux.api';

describe('CarreauxApi', () => {
  it('urlTuiles : adresse ABSOLUE de /api/tiles, jetons {z}/{x}/{y} intacts, version du schéma — et aucun appel HTTP', () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), CarreauxApi,
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    const url = TestBed.inject(CarreauxApi).urlTuiles();
    expect(url).toBe(`${new URL('/api/tiles/', document.baseURI).href}{z}/{x}/{y}?v=${CARREAUX_TILE_VERSION}`);
    TestBed.inject(HttpTestingController).verify();
  });
});
