export type MeteoVariable =
  | 'precipitation'
  | 'temperature_2m'
  | 'windspeed_10m'
  | 'sunshine_duration';

export type MeteoMode = 'forecast' | 'history';

export type MeteoAggregationFn = 'sum' | 'mean' | 'max';

export interface MeteoParams {
  variable: MeteoVariable;
  startDate: string;
  endDate: string;
  resolution?: number;
}

export interface GridPoint {
  lon: number;
  lat: number;
}

export interface MeteoSquare {
  squareId: string;
  center: GridPoint;
  geometry: GeoJSON.Polygon;
  weatherValue: number;
}

export interface MeteoStats {
  min: number;
  max: number;
  mean: number;
  p20: number;
  p40: number;
  p60: number;
  p80: number;
  unit: string;
}

export interface MeteoMeta {
  variable: MeteoVariable;
  unit: string;
  startDate: string;
  endDate: string;
  resolution: number;
  stats: MeteoStats;
}

export interface MeteoSummary {
  in_zone_impressions: number;
  total_impressions: number;
  pct_in_zone: number;
  total_zones: number;
  zones_with_impressions: number;
}

export interface MeteoApiResponse {
  geojson: GeoJSON.FeatureCollection;
  summary: MeteoSummary;
  meta: MeteoMeta;
}

/** Scale admin supportée par l'endpoint /api/meteo-geo */
export type MeteoScale = 'region' | 'departement' | 'cp';

/** Valeur météo pour une zone admin (une seule par zone) */
export interface MeteoZoneValue {
  value: number;
  unit: string;
  label: string;
}

/** Métadonnées de la réponse /api/meteo-geo */
export interface MeteoZoneMeta {
  variable: MeteoVariable;
  unit: string;
  startDate: string;
  endDate: string;
  scale: MeteoScale;
  stats: MeteoStats;
  totalZones: number;
  batchesTotal: number;
  cachedAt: string | null;
}

/** Réponse complète de /api/meteo-geo (status = done) */
export interface MeteoZoneResponse {
  data: Record<string, MeteoZoneValue>;
  meta: MeteoZoneMeta;
}

/** Chunk intermédiaire NDJSON pendant le streaming */
export type MeteoZoneChunk =
  | { status: 'fetching'; progress: number; total: number; etaMs?: number }
  | { status: 'done'; progress: number; total: number; data: Record<string, MeteoZoneValue>; meta: MeteoZoneMeta }
  | { status: 'error'; error: string };

export const METEO_UNIT: Record<MeteoVariable, string> = {
  precipitation: 'mm',
  temperature_2m: '°C',
  windspeed_10m: 'km/h',
  sunshine_duration: 's',
};

export const METEO_AGGREGATION: Record<MeteoVariable, MeteoAggregationFn> = {
  precipitation: 'sum',
  temperature_2m: 'mean',
  windspeed_10m: 'max',
  sunshine_duration: 'sum',
};

// Nom exact du champ dans la réponse Open-Meteo `daily.*` selon la variable.
// Permet de requêter en daily (volume 24× plus petit qu'en hourly) et
// d'extraire directement la valeur quotidienne déjà agrégée côté API.
export const METEO_DAILY_FIELD: Record<MeteoVariable, string> = {
  precipitation: 'precipitation_sum',
  temperature_2m: 'temperature_2m_mean',
  windspeed_10m: 'windspeed_10m_max',
  sunshine_duration: 'sunshine_duration',
};

export const METEO_LABEL: Record<MeteoVariable, string> = {
  precipitation: 'Précipitations',
  temperature_2m: 'Température',
  windspeed_10m: 'Vent',
  sunshine_duration: 'Ensoleillement',
};
