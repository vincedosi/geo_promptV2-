import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { VORONOI_PALETTE } from '../logique/palettes-donnees-carte';
import { BatailleService, type CreneauBataille } from './bataille.service';
import { CaptureService } from '../etat/capture.service';

const CRENEAU: CreneauBataille = {
  anneaux: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { id: 'z', nom: 'Zone', palier: 1 } }],
  pois: [{ id: 'z', nom: 'Zone', lat: 0.5, lng: 0.5 }],
  cle: 'cg__z',
  categorie: 'custom_geo_zone',
};

function monter() {
  TestBed.configureTestingModule({ providers: [CaptureService, provideZonelessChangeDetection(), BatailleService, CouchesCarteService] });
  const carte = new CarteFactice();
  carte.styleCharge = true;
  const couches = TestBed.inject(CouchesCarteService);
  couches.publier(carte as unknown as maplibregl.Map);
  const service = TestBed.inject(BatailleService);
  TestBed.tick();
  return { service, carte, couches };
}

describe('BatailleService (créneau de bataille, T14)', () => {
  it('vide par défaut : aucune source, aucune clé', () => {
    const { service, carte } = monter();
    expect(carte.sources.size).toBe(0);
    expect(service.cle()).toBeNull();
  });

  it('appliquer → anneaux colorés (palette Voronoï, opacité 0,20 d’un palier inconnu), point au centre, halo SOUS le point', () => {
    const { service, carte } = monter();
    service.appliquer(CRENEAU);
    TestBed.tick();
    expect(service.cle()).toBe('cg__z');
    expect(carte.ordreRendu()).toEqual(['battle-fill', 'battle-ring-line', 'battle-pois-halo', 'battle-pois-circle']);
    const anneaux = (carte.sources.get('battle-rings')!.spec as { data: GeoJSON.FeatureCollection }).data.features;
    expect(anneaux[0].properties).toMatchObject({ battle_color: VORONOI_PALETTE[0], battle_opacity: 0.2, palier: 1 });
    const points = (carte.sources.get('battle-pois')!.spec as { data: GeoJSON.FeatureCollection }).data.features;
    expect(points.map((p) => (p.geometry as GeoJSON.Point).coordinates)).toEqual([[0.5, 0.5]]);
    expect(service.legende()).toEqual([{ id: 'z', nom: 'Zone', color: VORONOI_PALETTE[0] }]);
  });

  it('un second créneau REMPLACE le premier par `setData`, sans recréer les couches', () => {
    const { service, carte } = monter();
    service.appliquer(CRENEAU);
    TestBed.tick();
    service.appliquer({ ...CRENEAU, cle: 'autre' });
    TestBed.tick();
    expect(carte.couches.length).toBe(4);
    expect(carte.sources.get('battle-rings')!.donnees.length).toBe(1);
  });

  it('« Tout effacer » → couches puis sources retirées, clé vidée', () => {
    const { service, carte, couches } = monter();
    service.appliquer(CRENEAU);
    TestBed.tick();
    couches.toutEffacer();
    TestBed.tick();
    expect(service.cle()).toBeNull();
    expect(carte.sources.size).toBe(0);
    expect(carte.couches.length).toBe(0);
  });

  it('carte recréée (B11) : le créneau est re-posé sur la nouvelle instance', () => {
    const { service, couches } = monter();
    service.appliquer(CRENEAU);
    TestBed.tick();
    couches.publier(null);
    TestBed.tick();
    const nouvelle = new CarteFactice();
    nouvelle.styleCharge = true;
    couches.publier(nouvelle as unknown as maplibregl.Map);
    TestBed.tick();
    expect(nouvelle.getLayer('battle-fill')).toBeDefined();
  });
});
