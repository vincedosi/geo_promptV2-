import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { ConfigService } from '../../../core/config/config.service';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { CarteApi } from '../data/carte.api';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { ApercuClusteringService, COUCHE_APERCU, SOURCE_APERCU } from './apercu-clustering.service';

const POIS = { pois: [{ id: 'a', nom: 'BMW Lille', lat: 50.63, lng: 3.06 }, { id: 'b', nom: 'BMW Arras', lat: 50.29, lng: 2.78 }] };

function monter() {
  const palette = signal({ remplissage: '#f7b731', cerne: '#050505' });
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(),
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      CarteApi, CouchesCarteService, ApercuClusteringService,
      { provide: CouleursService, useValue: { palette: () => palette } },
    ],
  });
  const carte = new CarteFactice();
  carte.styleCharge = true;
  const couches = TestBed.inject(CouchesCarteService);
  couches.publier(carte as unknown as maplibregl.Map);
  return { service: TestBed.inject(ApercuClusteringService), http: TestBed.inject(HttpTestingController), carte, couches, palette };
}

const visibilite = (c: CarteFactice) => c.dispositions.filter((d) => d.couche === COUCHE_APERCU && d.propriete === 'visibility').map((d) => d.valeur);

describe('ApercuClusteringService (page.tsx:410-436, useMapInit.ts:746-760)', () => {
  it('le corps EXACT de React, puis les points posés, couche visible, teintes calculées', () => {
    const { service, http, carte } = monter();
    service.afficher(['bmw'], true);
    const req = http.expectOne('/api/map/pois');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ poi_types: ['bmw'], scope: 'metro', regions: [], depts: [], ville: '', rayon_poi: null, poi_natures: {} });
    req.flush(POIS);
    TestBed.tick();
    expect(carte.sources.get(SOURCE_APERCU)!.donnees.at(-1)).toMatchObject({ features: [{ properties: { id: 'a', nom: 'BMW Lille' } }, {}] });
    expect(carte.getLayer(COUCHE_APERCU)!['paint']).toEqual({
      'circle-color': '#f7b731', 'circle-radius': 5, 'circle-opacity': 0.8, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#050505',
    });
    expect(visibilite(carte).at(-1)).toBe('visible');
  });

  it('« toute la France » → scope all ; mêmes types relus → servis par le cache, aucune requête', () => {
    const { service, http } = monter();
    service.afficher(['bmw', 'cirfa'], false);
    const req = http.expectOne('/api/map/pois');
    expect(req.request.body.scope).toBe('all');
    req.flush(POIS);
    service.afficher(['cirfa', 'bmw'], false);
    http.expectNone('/api/map/pois');
  });

  it('sélection vidée ou assistant fermé → aperçu masqué ; une sélection rapprochée annule la précédente', () => {
    const { service, http, carte } = monter();
    service.afficher(['bmw'], true);
    http.expectOne('/api/map/pois').flush(POIS);
    TestBed.tick();
    service.afficher([], true);
    TestBed.tick();
    expect(visibilite(carte).at(-1)).toBe('none');
    service.afficher(['lycee'], true);
    const premiere = http.expectOne('/api/map/pois');
    service.afficher(['cirfa'], true);
    expect(premiere.cancelled).toBe(true);
    http.expectOne('/api/map/pois');
    service.effacer();
    TestBed.tick();
    expect(visibilite(carte).at(-1)).toBe('none');
  });

  it('un échec n’affiche rien et ne lève pas (best effort)', () => {
    const { service, http, carte } = monter();
    service.afficher(['bmw'], true);
    http.expectOne('/api/map/pois').flush({ error: 'panne' }, { status: 500, statusText: 'Error' });
    TestBed.tick();
    expect(carte.getLayer(COUCHE_APERCU)).toBeUndefined();
  });

  it('thème → setPaintProperty des deux teintes, sans setData', () => {
    const { service, http, carte, palette } = monter();
    service.afficher(['bmw'], true);
    http.expectOne('/api/map/pois').flush(POIS);
    TestBed.tick();
    const ecritures = carte.sources.get(SOURCE_APERCU)!.donnees.length;
    palette.set({ remplissage: '#c08400', cerne: '#050505' });
    TestBed.tick();
    expect(carte.peintures.filter((p) => p.couche === COUCHE_APERCU).at(-2)).toEqual({ couche: COUCHE_APERCU, propriete: 'circle-color', valeur: '#c08400' });
    expect(carte.sources.get(SOURCE_APERCU)!.donnees.length).toBe(ecritures);
  });

  it('« Tout effacer » vide l’aperçu ; une carte recréée re-pose la couche sans requête', () => {
    const { service, http, couches } = monter();
    service.afficher(['bmw'], true);
    http.expectOne('/api/map/pois').flush(POIS);
    TestBed.tick();
    const nouvelle = new CarteFactice();
    nouvelle.styleCharge = true;
    couches.publier(nouvelle as unknown as maplibregl.Map);
    TestBed.tick();
    expect(nouvelle.getLayer(COUCHE_APERCU)).toBeDefined();
    couches.toutEffacer();
    TestBed.tick();
    expect(visibilite(nouvelle).at(-1)).toBe('none');
    http.verify();
  });
});
