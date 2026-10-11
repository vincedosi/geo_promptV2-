/**
 * Les formes que rendent les routes `/api/poi-clusters/*` — recopiées des types locaux de `ClusterPanel.tsx`,
 * `ClusteringSection.tsx` et `components/ClusterDetails.tsx` (lot 4, T19), qui ne les exportaient pas tous.
 */

/** Un cluster tel que `metadata.cluster_summary` / `cluster_summary` le décrit (`ClusterSummaryEntry`). */
export interface ResumeCluster {
  label: string;
  count: number;
  /** Hexadécimal choisi par la ROUTE (`CLUSTER_COLORS[i % 10]`) : une donnée, identique dans les deux thèmes. */
  color: string;
  avg_profile: Record<string, number>;
}

/** `metadata` de `GET /api/poi-clusters?duration=` (`ClusterGeoJSON.metadata`). */
export interface MetaClusters {
  model_version: number;
  k: number;
  silhouette_score: number;
  n_pca_components: number;
  variance_explained: number;
  duration_minutes: number;
  mode: string;
  created_at: string;
  cluster_summary: Record<string, ResumeCluster>;
  feature_names: string[];
}

/** Un POI classé, point de la carte. Propriétés PLATES : `profile_features` et `pca_components` sont des JSON en texte. */
export interface EntiteCluster {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: Record<string, string | number>;
}

/** La réponse de `GET /api/poi-clusters?duration=` (`ClusterGeoJSON`). */
export interface ClustersGeoJSON {
  type: 'FeatureCollection';
  features: EntiteCluster[];
  metadata: MetaClusters;
}

/** Un POI choisi sur la carte ou dans la table (`ClusterPoi`). */
export interface PoiCluster {
  poi_id: string;
  poi_name: string;
  cluster_id: number;
  cluster_label: string;
  cluster_color: string;
  categorie: string;
  ville: string;
  profile_features: Record<string, number>;
  lat?: number;
  lng?: number;
}

/** Une ligne de `GET /api/poi-clusters/models` (`ClusterModelSummary`). */
export interface ResumeModele {
  version: number;
  k: number;
  silhouette_score: number;
  n_poi_trained: number;
  duration_minutes: number;
  mode: string;
  created_at: string;
}

/** `model` de `GET /api/poi-clusters/models/[version]` (`ModelDetail`). */
export interface DetailModele {
  version: number;
  k: number;
  silhouette_score: number;
  n_pca_components: number;
  variance_explained: number;
  feature_names: string[];
  feature_themes: string[] | null;
  cluster_labels: Record<string, string>;
  cluster_avg_profiles: Record<string, Record<string, number>>;
  n_poi_trained: number;
  duration_minutes: number;
  mode: string;
  created_at: string;
  cluster_mapping_from_previous: Record<string, number> | null;
}

/** Un élément de `poi_list` (`PoiRecord`). */
export interface PoiModele {
  poi_id: string;
  poi_name: string;
  categorie: string;
  ville: string;
  lat?: number;
  lng?: number;
  cluster_id: number;
  cluster_label: string;
  cluster_color: string;
  profile_features: Record<string, number>;
  pca_components: number[];
  n_carreaux_intersected?: number | null;
  population_totale_couverte?: number | null;
  imputed_features: string[];
  duration_minutes: number;
  mode: string;
}

/** La réponse de `GET /api/poi-clusters/models/[version]`. */
export interface ReponseModele {
  model: DetailModele;
  cluster_summary: Record<string, ResumeCluster>;
  poi_list: PoiModele[];
}

/** `averages` de `GET /api/poi-clusters/france-averages` (`FranceAverages`). */
export type MoyennesFrance = Record<string, { avg: number; std: number; min: number; max: number; n_carreaux: number }>;

/** Une ligne de `GET /api/poi-clusters/history/[poiId]` (`HistoryEntry`). */
export interface EntreeHistorique {
  id: number;
  cluster_id: number;
  cluster_label: string | null;
  model_version: number;
  action: string;
  previous_cluster_id: number | null;
  changed: boolean;
  created_at: string;
}

/** `GET /api/poi-clusters/poi/[poiId]` : un profil par durée d'isochrone. */
export interface ProfilsPoi {
  poi_id: string;
  durations: Record<string, { profile_features?: Record<string, number> }>;
}
