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

export const METEO_LABEL: Record<MeteoVariable, string> = {
  precipitation: 'Précipitations',
  temperature_2m: 'Température',
  windspeed_10m: 'Vent',
  sunshine_duration: 'Ensoleillement',
};
