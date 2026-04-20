export interface CustomGeoZoneSummary {
  id: string;
  name: string;
  description: string | null;
  source_type: string;
  source_metadata: Record<string, unknown>;
  feature_count_iris: number;
  feature_count_cp: number;
  bbox: [number, number, number, number] | null;
  created_at: string;
  created_by: string | null;
}

export interface CustomGeoZoneFull extends CustomGeoZoneSummary {
  org_id: string;
  resolved_at: string | null;
  updated_at: string;
}

export interface CustomGeoZoneGeometry {
  type: 'Feature';
  geometry: GeoJSON.MultiPolygon;
  properties: {
    id: string;
    name: string;
    source_type: string;
    source_metadata: Record<string, unknown>;
    feature_count_iris: number;
    feature_count_cp: number;
  };
}

export type CustomGeoExportFormat = 'csv_cp' | 'csv_iris' | 'geojson';

export type CaptureTransformation = 'union' | 'convex_hull' | 'envelope' | 'raw';

export type ContributedGeometry = GeoJSON.Geometry | GeoJSON.Geometry[] | null;

export interface ContributedLayer {
  id: string;
  sourceType: string;
  label: string;
  /**
   * Appele uniquement au moment de la capture. Peut etre async si le module
   * recupere sa geometrie via une RPC / API (cas des modules avec geometrie
   * cote serveur : battle, clusters, radio coverage, admin filter, etc.).
   */
  getGeometry: () => ContributedGeometry | Promise<ContributedGeometry>;
  metadata?: Record<string, unknown>;
  enabled: boolean;
}
