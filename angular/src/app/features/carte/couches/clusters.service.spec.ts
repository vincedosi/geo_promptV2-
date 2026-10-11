import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { FABRIQUE_POPUP } from '../../../carte/fabrique-carte';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { ConfigService } from '../../../core/config/config.service';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { ClusteringApi } from '../data/clustering.api';
import { CaptureService } from '../etat/capture.service';
import { CouchesCarteService } from '../etat/couches-carte.service';
import type { ClustersGeoJSON, PoiCluster } from '../logique/clustering/types';
import { COUCHE_CLUSTERS, ClustersService, SOURCE_CLUSTERS } from './clusters.service';

const geo = (version: number, duree: number): ClustersGeoJSON => ({
  type: 'FeatureCollection',
  features: [{
    type: 'Feature', geometry: { type: 'Point', coordinates: [5.37, 43.3] },
    properties: { poi_id: 'p1', poi_name: 'Lycée <b>', cluster_id: 1, cluster_label: 'Jeune adulte', cluster_color: '#f28e2b', categorie: 'lycee', ville: 'Marseille', profile_features: '{"pct_0_17":0.2}' },
  }],
  metadata: {
    model_version: version, k: 4, silhouette_score: 0.3, n_pca_components: 5, variance_explained: 0.86, duration_minutes: duree,
    mode: 'drive', created_at: '2026-09-12T09:52:55Z', cluster_summary: {}, feature_names: [],
  },
});

function monter() {
  const contour = signal({ contour: '#ffffff' });
  const popups: { options: unknown; contenu: Node | null }[] = [];
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(),
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ClusteringApi, ClustersService, CouchesCarteService, CaptureService,
      { provide: CouleursService, useValue: { palette: () => contour } },
      {
        provide: FABRIQUE_POPUP, useValue: (options: unknown) => {
          const p = { options, contenu: null as Node | null };
          popups.push(p);
          const popup = { setLngLat: () => popup, setDOMContent: (n: Node) => { p.contenu = n; return popup; }, addTo: () => popup, remove: () => popup };
          return popup;
        },
      },
    ],
  });
  const carte = new CarteFactice();
  carte.styleCharge = true;
  const couches = TestBed.inject(CouchesCarteService);
  couches.publier(carte as unknown as maplibregl.Map);
  return {
    service: TestBed.inject(ClustersService), http: TestBed.inject(HttpTestingController), carte, couches, contour, popups,
    capture: TestBed.inject(CaptureService),
  };
}

const visibilite = (c: CarteFactice) => c.dispositions.filter((d) => d.couche === COUCHE_CLUSTERS && d.propriete === 'visibility').map((d) => d.valeur);

describe('ClustersService (page.tsx:386-470, useMapInit.ts:762-830)', () => {
  it('première ouverture → ?duration=60 UNE fois, données posées, couche visible', () => {
    const { service, http, carte } = monter();
    service.charger();
    expect(service.chargement()).toBe(true);
    http.expectOne('/api/poi-clusters?duration=60').flush(geo(3, 60));
    TestBed.tick();
    expect(service.chargement()).toBe(false);
    expect(carte.sources.get(SOURCE_CLUSTERS)!.donnees).toHaveLength(1);
    const couche = carte.getLayer(COUCHE_CLUSTERS)!;
    expect(couche['paint']).toEqual({
      'circle-color': ['get', 'cluster_color'], 'circle-radius': 7, 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff', 'circle-opacity': 0.92,
    });
    expect(visibilite(carte).at(-1)).toBe('visible');
    http.verify();
  });

  it('bascule → setLayoutProperty SEULEMENT : aucun setData, aucune requête', () => {
    const { service, http, carte } = monter();
    service.charger();
    http.expectOne('/api/poi-clusters?duration=60').flush(geo(3, 60));
    TestBed.tick();
    const avant = carte.sources.get(SOURCE_CLUSTERS)!.donnees.length;
    service.basculerVisibilite();
    TestBed.tick();
    expect(visibilite(carte).at(-1)).toBe('none');
    service.charger(); // données déjà là : React bascule, il ne relit pas
    TestBed.tick();
    expect(visibilite(carte).at(-1)).toBe('visible');
    expect(carte.sources.get(SOURCE_CLUSTERS)!.donnees.length).toBe(avant);
    http.verify();
  });

  it('changer de durée → nouvelle requête, nouvelles données, couche visible', () => {
    const { service, http, carte } = monter();
    service.charger();
    http.expectOne('/api/poi-clusters?duration=60').flush(geo(3, 60));
    service.changerDuree(30);
    expect(service.duree()).toBe(30);
    http.expectOne('/api/poi-clusters?duration=30').flush(geo(4, 30));
    TestBed.tick();
    expect(service.donnees()!.metadata.model_version).toBe(4);
    expect(carte.sources.get(SOURCE_CLUSTERS)!.donnees.at(-1)).toEqual(geo(4, 30));
    http.verify();
  });

  it('404 « aucun modèle » : le message nomme la durée et les modèles calculés — jamais un chargement sans fin', () => {
    const { service, http } = monter();
    service.chargerModeles();
    http.expectOne('/api/poi-clusters/models').flush({ models: [{ version: 3, duration_minutes: 15 }, { version: 2, duration_minutes: 15 }] });
    service.charger();
    http.expectOne('/api/poi-clusters?duration=60').flush({ error: 'Aucun modèle de clustering trouvé' }, { status: 404, statusText: 'Not Found' });
    expect(service.chargement()).toBe(false);
    expect(service.donnees()).toBeNull();
    expect(service.erreur()).toBe('Aucun modèle de clustering à 60 min — modèles calculés : 15 min.');
  });

  it('durée sans modèle alors qu’un modèle est affiché : le sélecteur revient sur la durée AFFICHÉE', () => {
    const { service, http } = monter();
    service.charger();
    http.expectOne('/api/poi-clusters?duration=60').flush(geo(3, 60));
    service.changerDuree(45);
    http.expectOne('/api/poi-clusters?duration=45').flush({ error: 'x' }, { status: 404, statusText: 'Not Found' });
    expect(service.duree()).toBe(60);
    expect(service.donnees()!.metadata.model_version).toBe(3);
    expect(service.erreur()).toContain('45 min');
  });

  it('carte recréée (changement de fond) → source re-posée avec les données, SANS requête', () => {
    const { service, http, couches } = monter();
    service.charger();
    http.expectOne('/api/poi-clusters?duration=60').flush(geo(3, 60));
    TestBed.tick();
    couches.publier(null);
    TestBed.tick();
    const neuve = new CarteFactice();
    neuve.styleCharge = true;
    couches.publier(neuve as unknown as maplibregl.Map);
    TestBed.tick();
    expect(neuve.sources.get(SOURCE_CLUSTERS)!.donnees).toEqual([geo(3, 60)]);
    expect(visibilite(neuve).at(-1)).toBe('visible');
    http.verify();
  });

  it('bascule de thème → setPaintProperty du cerne, sans setData', () => {
    const { service, http, carte, contour } = monter();
    service.charger();
    http.expectOne('/api/poi-clusters?duration=60').flush(geo(3, 60));
    TestBed.tick();
    const n = carte.sources.get(SOURCE_CLUSTERS)!.donnees.length;
    contour.set({ contour: '#eeeeee' });
    TestBed.tick();
    expect(carte.peintures.at(-1)).toEqual({ couche: COUCHE_CLUSTERS, propriete: 'circle-stroke-color', valeur: '#eeeeee' });
    expect(carte.sources.get(SOURCE_CLUSTERS)!.donnees.length).toBe(n);
  });

  it('clic sur un point : popup en TEXTE (aucun HTML interprété) et POI transmis aux écouteurs', () => {
    const { service, http, carte, popups } = monter();
    const recus: PoiCluster[] = [];
    service.ecouterSelection((p) => recus.push(p));
    service.charger();
    http.expectOne('/api/poi-clusters?duration=60').flush(geo(3, 60));
    TestBed.tick();
    carte.emettreSurCouche('click', COUCHE_CLUSTERS, { features: [{ properties: geo(3, 60).features[0].properties }], lngLat: { lat: 43.3, lng: 5.37 } });
    expect(recus[0]).toMatchObject({ poi_id: 'p1', cluster_id: 1, profile_features: { pct_0_17: 0.2 }, lat: 43.3 });
    const contenu = popups[0].contenu as HTMLElement;
    expect(contenu.textContent).toContain('Lycée <b>');
    expect(contenu.querySelector('b')).toBeNull();
  });

  it('« Tout effacer » : plus de données, couche éteinte, source vidée', () => {
    const { service, http, carte, couches } = monter();
    service.charger();
    http.expectOne('/api/poi-clusters?duration=60').flush(geo(3, 60));
    TestBed.tick();
    couches.toutEffacer();
    TestBed.tick();
    expect(service.donnees()).toBeNull();
    expect(service.visible()).toBe(false);
    expect(carte.sources.get(SOURCE_CLUSTERS)!.donnees.at(-1)).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('capture : la couche contribue ses points (géométrie locale) quand elle est allumée', () => {
    const { service, http, capture } = monter();
    expect(capture.sources()).toEqual([]);
    service.charger();
    http.expectOne('/api/poi-clusters?duration=60').flush(geo(3, 60));
    const [source] = capture.sources();
    expect(source).toMatchObject({ id: 'map-poi-clusters', sourceType: 'poi_clusters', label: 'Clusters POI (1 groupes)', metadata: { cluster_count: 1 } });
    expect('locale' in source.obtenir && source.obtenir.locale()).toEqual([{ type: 'Point', coordinates: [5.37, 43.3] }]);
    service.basculerVisibilite();
    expect(capture.sources()).toEqual([]);
  });
});
