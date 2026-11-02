/**
 * Stats agrégées calculées au moment de la capture sur les carreaux INSEE 200m
 * intersectant la zone. Exploitable pour DSP bidding (volume audience, ciblage).
 * Si `skipped: true`, la zone dépassait 5000 km² (cap I/O).
 */
export interface AudienceStats {
  computed_at: string;
  area_km2: number;
  carreaux_count?: number;
  skipped?: boolean;
  reason?: string;
  population?: {
    total: number;
    density_per_km2: number;
    by_age: {
      '0_17': number;
      '18_24': number;
      '25_39': number;
      '40_54': number;
      '55_64': number;
      '65_79': number;
      '80_plus': number;
    };
  };
  menages?: {
    total: number;
    '1_personne': number;
    '5_plus': number;
    proprietaires: number;
    monoparentales: number;
    pauvres: number;
  };
  logements?: {
    maisons: number;
    collectifs: number;
    sociaux: number;
    avant_1945: number;
    '1945_1970': number;
    '1970_1990': number;
    apres_1990: number;
    surface_moyenne_m2: number;
  };
  revenu_median_par_uc?: number;
}

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
  /** Codes département INSEE résolus (issus de custom_geo_zone_codes, code_type='dept') */
  dept_codes?: string[];
  /** Codes région INSEE résolus (issus de custom_geo_zone_codes, code_type='region') */
  region_codes?: string[];
  /** Surface géodésique de la forme, en km² (colonne générée, sql/316, B10) : le rayon par défaut de la maille cercle de ⑤. */
  surface_km2?: number | null;
}

export interface CustomGeoZoneFull extends CustomGeoZoneSummary {
  org_id: string;
  resolved_at: string | null;
  updated_at: string;
  audience_stats: AudienceStats | Record<string, never>;
  audience_computed_at: string | null;
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

export type CustomGeoExportFormat =
  | 'csv_cp'
  | 'csv_iris'
  | 'geojson'
  | 'dv360_cp'
  | 'dv360_sdf'
  | 'bidding_script'
  | 'tiktok_geo';

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
