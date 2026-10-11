import { provideHttpClient } from '@angular/common/http';
import type { EnvironmentProviders, Provider } from '@angular/core';
import { ConfigService } from '../../../../../../core/config/config.service';
import { CouleursService } from '../../../../../../core/theme/couleurs.service';
import { FABRIQUE_POPUP } from '../../../../../../carte/fabrique-carte';
import { FABRIQUE_GRAPHIQUE } from '../../../../../../graphiques/fabrique-graphique';
import { ClustersService } from '../../../../couches/clusters.service';
import { ClusteringApi } from '../../../../data/clustering.api';
import { CaptureService } from '../../../../etat/capture.service';
import { CouchesCarteService } from '../../../../etat/couches-carte.service';
import { AnnonceService } from '../../../../etat/annonce.service';
import { EtatCarteService } from '../../../../etat/etat-carte.service';
import { PileEchapService } from '../../../../etat/pile-echap.service';
import type { ClustersGeoJSON, ReponseModele, ResumeModele } from '../../../../logique/clustering/types';

/** Les deux modèles de la base locale (versions 2 et 3, 15 min en voiture). */
export const MODELES: ResumeModele[] = [
  { version: 3, k: 4, silhouette_score: 0.2992347391058109, n_poi_trained: 95, duration_minutes: 15, mode: 'drive', created_at: '2026-09-12T09:52:55.448365+00:00' },
  { version: 2, k: 7, silhouette_score: 0.3248365565574872, n_poi_trained: 95, duration_minutes: 15, mode: 'drive', created_at: '2026-09-12T08:33:44.151713+00:00' },
];

const entite = (id: string, nom: string, cid: number, lng: number, lat: number, couleur: string) => ({
  type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [lng, lat] as [number, number] },
  properties: {
    poi_id: id, poi_name: nom, cluster_id: cid, cluster_label: cid === 0 ? 'Seniors actifs / Proprietaires' : 'Jeune adulte / Locataires',
    cluster_color: couleur, categorie: 'lycee', ville: 'Lyon', profile_features: JSON.stringify({ pct_0_17: 0.2 + cid / 10, revenu_moyen: 1.1 }),
  },
});

/** Une réponse de `GET /api/poi-clusters?duration=` : 2 clusters, 3 POI. */
export const CLUSTERS: ClustersGeoJSON = {
  type: 'FeatureCollection',
  features: [
    entite('p1', 'Lycée Ampère', 0, 4.83, 45.76, '#4e79a7'),
    entite('p2', 'Lycée du Parc', 1, 4.85, 45.77, '#f28e2b'),
    entite('p3', 'Lycée Saint-Exupéry', 0, 4.80, 45.78, '#4e79a7'),
  ],
  metadata: {
    model_version: 3, k: 2, silhouette_score: 0.2992347391058109, n_pca_components: 5, variance_explained: 0.8612, duration_minutes: 60,
    mode: 'drive', created_at: '2026-09-12T09:52:55Z', feature_names: ['pct_0_17', 'pct_18_39', 'pct_40_54', 'revenu_moyen'],
    cluster_summary: {
      '0': { label: 'Seniors actifs / Proprietaires', count: 2, color: '#4e79a7', avg_profile: { pct_0_17: 0.2, pct_18_39: 0.2, pct_40_54: 0.2, revenu_moyen: 1.2 } },
      '1': { label: 'Jeune adulte / Locataires', count: 1, color: '#f28e2b', avg_profile: { pct_0_17: 0.3, pct_18_39: 0.3, pct_40_54: 0.1, revenu_moyen: 0.9 } },
    },
  },
};

/** Une réponse de `GET /api/poi-clusters/models/3`. */
export const DETAIL_MODELE: ReponseModele = {
  model: {
    version: 3, k: 2, silhouette_score: 0.2992347391058109, n_pca_components: 5, variance_explained: 0.8612,
    feature_names: ['pct_0_17', 'pct_18_39', 'pct_40_54', 'revenu_moyen'], feature_themes: ['demographie', 'revenus', 'logement', 'menages'],
    cluster_labels: { '0': 'Seniors actifs / Proprietaires', '1': 'Jeune adulte / Locataires' }, cluster_avg_profiles: {},
    n_poi_trained: 95, duration_minutes: 15, mode: 'drive', created_at: '2026-09-12T09:52:55.448365+00:00',
    cluster_mapping_from_previous: { '0': 1, '1': 0 },
  },
  cluster_summary: CLUSTERS.metadata.cluster_summary,
  poi_list: [
    {
      poi_id: 'p1', poi_name: 'Lycée Ampère', categorie: 'lycee', ville: 'Lyon', cluster_id: 0, cluster_label: 'Seniors actifs / Proprietaires',
      cluster_color: '#4e79a7', profile_features: {}, pca_components: [0.5, -0.1], imputed_features: ['taux_hlm'], duration_minutes: 15, mode: 'drive',
      n_carreaux_intersected: 812,
    },
  ],
};

/**
 * Les doublures du navigateur absentes de l'environnement de test : `ResizeObserver` (graphiques) et `showModal` /
 * `close` du `<dialog>` (rapport) — patrons de `courbe.component.spec.ts` et `confirmation.component.spec.ts`.
 */
export function preparerNavigateur(): void {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} disconnect() {} };
  if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); }, configurable: true, writable: true });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { value: function (this: HTMLDialogElement) { this.removeAttribute('open'); }, configurable: true, writable: true });
  }
}

/** Une bulle factice : sans WebGL, la vraie `maplibregl.Popup` ne s'attache pas à la carte factice. */
const popupFactice = () => {
  const p = { setLngLat: () => p, setDOMContent: () => p, addTo: () => p, remove: () => p };
  return p;
};

/**
 * Les fournisseurs des specs du clustering : couleurs, graphiques et bulles FACTICES (pas de feuille de style ni de
 * canevas en test — `CouleursService` lèverait sur un jeton absent, ECharts n'a pas de rendu). Chaque spec y ajoute
 * `provideHttpClientTesting()` : ce fichier n'est pas une spec, il ne doit rien importer de `…/testing` d'Angular
 * (garde `imports-partages.test.ts`).
 */
export function fournisseursClustering(): (Provider | EnvironmentProviders)[] {
  preparerNavigateur();
  return [
    { provide: FABRIQUE_POPUP, useValue: popupFactice },
    provideHttpClient(),
    { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ClusteringApi, ClustersService, CouchesCarteService, CaptureService, PileEchapService, EtatCarteService, AnnonceService,
    { provide: CouleursService, useValue: { palette: (j: Record<string, string>) => () => Object.fromEntries(Object.keys(j).map((k) => [k, '#123456'])) } },
    { provide: FABRIQUE_GRAPHIQUE, useValue: () => ({ setOption: () => undefined, resize: () => undefined, dispose: () => undefined }) },
  ];
}
