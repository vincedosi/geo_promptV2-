/**
 * Type definitions for map components
 */

export interface Panel {
  id: string;
  latitude: number;
  longitude: number;
  lat?: number;
  lng?: number;
  nom?: string;
  nom_site?: string;
  ville?: string;
  region?: string;
  department?: string;
  format?: string;
  type?: string;
  regie?: string;
  categorie?: string;
  available?: boolean;
  photo_url?: string;
  score?: number;
  [key: string]: any;
}

export interface ClusterFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
  properties: {
    cluster?: boolean;
    cluster_id?: number;
    point_count?: number;
    point_count_abbreviated?: string;
  };
  id?: string | number;
}

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: ClusterFeature[];
}

export interface MapViewport {
  latitude: number;
  longitude: number;
  zoom: number;
  bearing?: number;
  pitch?: number;
}

export interface FilterState {
  panelTypes: string[];
  city?: string;
  department?: string;
  available?: boolean;
  radius?: number;
  minScore?: number;
}

export interface PanelCluster {
  id: number | string;
  lat: number;
  lng: number;
  cluster: boolean;
  cluster_id?: number;
  point_count?: number;
  expansion_zoom?: number;
}
