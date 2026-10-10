import { CaptureService } from '../etat/capture.service';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { FABRIQUE_POPUP } from '../../../carte/fabrique-carte';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { VORONOI_PALETTE } from '../logique/palettes-donnees-carte';
import { BatailleService, type CreneauBataille } from './bataille.service';

const CRENEAU: CreneauBataille = {
  anneaux: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { id: 'z', nom: 'Zone', palier: 1 } }],
  pois: [{ id: 'z', nom: 'Zone', lat: 0.5, lng: 0.5 }],
  cle: 'cg__z',
  categorie: 'custom_geo_zone',
};

const ANNEAU_30: GeoJSON.Feature = {
  type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[5, 43], [5.5, 43.5], [5, 43]]] },
  properties: { feature_type: 'ring', id: 'a', nom: 'CIRFA Marseille', palier: 30, adresse: '1 rue', ville: 'Marseille' },
};
const BORDURE: GeoJSON.Feature = { type: 'Feature', geometry: { type: 'LineString', coordinates: [[5, 43], [5.5, 43.5]] }, properties: { feature_type: 'border' } };

class PopupFactice {
  contenu: HTMLElement | null = null;
  constructor(readonly options: maplibregl.PopupOptions) {}
  setLngLat() { return this; }
  setDOMContent(n: HTMLElement) { this.contenu = n; return this; }
  addTo() { return this; }
  remove() { return this; }
}
const popups: PopupFactice[] = [];

function monter() {
  popups.length = 0;
  TestBed.configureTestingModule({
    providers: [CaptureService, provideZonelessChangeDetection(), BatailleService, CouchesCarteService, { provide: FABRIQUE_POPUP, useValue: (o: maplibregl.PopupOptions) => { const p = new PopupFactice(o); popups.push(p); return p; } }],
  });
  const carte = new CarteFactice();
  carte.styleCharge = true;
  const couches = TestBed.inject(CouchesCarteService);
  couches.publier(carte as unknown as maplibregl.Map);
  const service = TestBed.inject(BatailleService);
  TestBed.tick();
  return { service, carte, couches };
}

const donnees = (carte: CarteFactice, source: string) =>
  ((carte.sources.get(source)!.donnees.at(-1) ?? (carte.sources.get(source)!.spec as { data: unknown }).data) as GeoJSON.FeatureCollection).features;

describe('BatailleService (créneau de bataille, T14 + T17)', () => {
  it('vide par défaut : aucune source, aucune clé, rien de visible', () => {
    const { service, carte } = monter();
    expect(carte.sources.size).toBe(0);
    expect(service.cle()).toBeNull();
    expect(service.visible()).toBe(false);
  });

  it('appliquer → anneaux colorés, point au centre, cinq couches dans l’ordre de React, halo SOUS le point', () => {
    const { service, carte } = monter();
    service.appliquer(CRENEAU);
    TestBed.tick();
    expect(service.cle()).toBe('cg__z');
    expect(service.categorie()).toBe('custom_geo_zone');
    expect(carte.ordreRendu()).toEqual(['battle-fill', 'battle-ring-line', 'battle-cirfa-border', 'battle-pois-halo', 'battle-pois-circle']);
    expect(donnees(carte, 'battle-rings')[0].properties).toMatchObject({ battle_color: VORONOI_PALETTE[0], battle_opacity: 0.2, palier: 1 });
    expect(donnees(carte, 'battle-pois').map((p) => (p.geometry as GeoJSON.Point).coordinates)).toEqual([[0.5, 0.5]]);
    expect(service.legende()).toEqual([{ id: 'z', nom: 'Zone', color: VORONOI_PALETTE[0] }]);
  });

  it('un second rendu REMPLACE le premier par `setData`, sans recréer les couches', () => {
    const { service, carte } = monter();
    service.appliquer(CRENEAU);
    TestBed.tick();
    service.appliquer({ ...CRENEAU, cle: 'autre' });
    TestBed.tick();
    expect(carte.couches.length).toBe(5);
    expect(carte.sources.get('battle-rings')!.donnees.length).toBeGreaterThan(0);
  });

  it('peindre (découpe) : sources `battle-rings` / `battle-borders` / `battle-pois` peintes, recadrage 60 px, z12, 1,2 s', () => {
    const { service, carte } = monter();
    service.peindre({ anneaux: [ANNEAU_30], bordures: [BORDURE], categorie: 'cirfa' });
    TestBed.tick();
    expect(donnees(carte, 'battle-rings')).toHaveLength(1);
    expect(donnees(carte, 'battle-borders')).toEqual([BORDURE]);
    expect(donnees(carte, 'battle-pois')).toHaveLength(0);
    expect(service.visible()).toBe(true);
    expect(carte.cadrages.at(-1)).toEqual({ cadre: [[5, 43], [5.5, 43.5]], options: { padding: 60, maxZoom: 12, duration: 1200 } });
  });

  it('palier maximum et « Voronoï » : UN filtre qui combine les deux (React les écrasait l’un l’autre)', () => {
    const { service, carte } = monter();
    service.peindre({ anneaux: [ANNEAU_30], categorie: 'cirfa' });
    TestBed.tick();
    service.palierMax.set(20);
    TestBed.tick();
    expect(carte.getLayer('battle-fill')!['filter']).toEqual(['all', ['!=', ['get', 'feature_type'], 'border'], ['!=', ['get', 'palier'], 0], ['<=', ['get', 'palier'], 20]]);
    service.contourVisible.set(true);
    TestBed.tick();
    expect(carte.getLayer('battle-ring-line')!['filter']).toEqual(['all', ['!=', ['get', 'feature_type'], 'border'], ['any', ['==', ['get', 'palier'], 0], ['<=', ['get', 'palier'], 20]]]);
  });

  it('masquer : les cinq couches passent à `none`, la catégorie reste (le bouton « Bataille » les rallume)', () => {
    const { service, carte } = monter();
    service.peindre({ anneaux: [ANNEAU_30], categorie: 'cirfa' });
    TestBed.tick();
    service.visible.set(false);
    TestBed.tick();
    for (const id of ['battle-fill', 'battle-ring-line', 'battle-cirfa-border', 'battle-pois-halo', 'battle-pois-circle']) {
      expect((carte.getLayer(id)!['layout'] as { visibility: string }).visibility).toBe('none');
    }
    expect(service.categorie()).toBe('cirfa');
  });

  it('anneaux partiels : cumulés à l’arrivée, vidés au départ d’une bataille', () => {
    const { service, carte } = monter();
    const brut = { cirfa_id: 'a', nom: 'A', lat: 43, lng: 5, palier: 10, geojson: ANNEAU_30.geometry };
    service.ajouterPartiels([brut]);
    service.ajouterPartiels([{ ...brut, cirfa_id: 'b' }]);
    TestBed.tick();
    expect(donnees(carte, 'battle-rings')).toHaveLength(2);
    expect(service.visible()).toBe(true);
    service.viderPartiels();
    TestBed.tick();
    expect(service.visible()).toBe(true);
    expect(carte.sources.get('battle-rings')).toBeUndefined();
  });

  it('clic sur un anneau : popup nom, adresse, ville, « ⏱ Anneau 30 min »', () => {
    const { service, carte } = monter();
    service.peindre({ anneaux: [ANNEAU_30], categorie: 'cirfa' });
    TestBed.tick();
    carte.emettreSurCouche('click', 'battle-fill', { lngLat: { lng: 5, lat: 43 }, features: [{ properties: ANNEAU_30.properties }] });
    expect(popups.at(-1)!.contenu!.textContent).toContain('CIRFA Marseille');
    expect(popups.at(-1)!.contenu!.textContent).toContain('⏱ Anneau 30 min');
  });

  it('« Tout effacer » → couches puis sources retirées, clé et catégorie vidées', () => {
    const { service, carte, couches } = monter();
    service.appliquer(CRENEAU);
    TestBed.tick();
    couches.toutEffacer();
    TestBed.tick();
    expect(service.cle()).toBeNull();
    expect(service.categorie()).toBe('');
    expect(carte.sources.size).toBe(0);
    expect(carte.couches.length).toBe(0);
  });

  it('carte recréée (B11) : le créneau est re-posé sur la nouvelle instance, avec son filtre', () => {
    const { service, couches } = monter();
    service.appliquer(CRENEAU);
    service.palierMax.set(40);
    TestBed.tick();
    couches.publier(null);
    TestBed.tick();
    const nouvelle = new CarteFactice();
    nouvelle.styleCharge = true;
    couches.publier(nouvelle as unknown as maplibregl.Map);
    TestBed.tick();
    expect(nouvelle.getLayer('battle-fill')).toBeDefined();
    expect(JSON.stringify(nouvelle.getLayer('battle-fill')!['filter'])).toContain('40');
  });
});
