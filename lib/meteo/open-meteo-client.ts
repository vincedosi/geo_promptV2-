import type { GridPoint, MeteoVariable } from './types';
import { aggregatePeriod } from './aggregation';

export type OpenMeteoHost =
  | 'api.open-meteo.com'
  | 'historical-forecast-api.open-meteo.com'
  | 'archive-api.open-meteo.com';

const ARCHIVE_CUTOFF = '2022-01-01';
const MAX_POINTS_PER_CALL = 500;

export function pickHost(startDate: string, endDate: string): OpenMeteoHost {
  const today = new Date().toISOString().slice(0, 10);
  if (endDate >= today) return 'api.open-meteo.com';
  if (startDate < ARCHIVE_CUTOFF) return 'archive-api.open-meteo.com';
  return 'historical-forecast-api.open-meteo.com';
}

export function buildOpenMeteoUrl(
  host: OpenMeteoHost,
  points: GridPoint[],
  variable: MeteoVariable,
  startDate: string,
  endDate: string,
): string {
  const endpoint =
    host === 'archive-api.open-meteo.com' ? '/v1/archive' : '/v1/forecast';
  const params = new URLSearchParams();
  params.set('latitude', points.map((p) => p.lat).join(','));
  params.set('longitude', points.map((p) => p.lon).join(','));
  params.set('hourly', variable);
  params.set('start_date', startDate);
  params.set('end_date', endDate);
  params.set('timezone', 'Europe/Paris');
  return `https://${host}${endpoint}?${params.toString()}`;
}

export interface PointWeatherResult {
  point: GridPoint;
  value: number;
}

interface OpenMeteoHourlyBlock {
  time?: string[];
  [key: string]: unknown;
}

interface OpenMeteoPointResponse {
  hourly?: OpenMeteoHourlyBlock;
  latitude?: number;
  longitude?: number;
}

export async function fetchWeatherForPoints(
  points: GridPoint[],
  variable: MeteoVariable,
  startDate: string,
  endDate: string,
): Promise<PointWeatherResult[]> {
  if (points.length === 0) return [];

  const host = pickHost(startDate, endDate);
  const results: PointWeatherResult[] = [];

  for (let i = 0; i < points.length; i += MAX_POINTS_PER_CALL) {
    const batch = points.slice(i, i + MAX_POINTS_PER_CALL);
    const url = buildOpenMeteoUrl(host, batch, variable, startDate, endDate);

    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Open-Meteo request failed (${res.status}): ${text.slice(0, 200)}`,
      );
    }

    const json = (await res.json()) as
      | OpenMeteoPointResponse
      | OpenMeteoPointResponse[];

    const list: OpenMeteoPointResponse[] = Array.isArray(json) ? json : [json];

    list.forEach((entry, idx) => {
      const hourly = entry.hourly ?? {};
      const rawValues =
        (hourly[variable] as (number | null)[] | undefined) ?? [];
      const value = aggregatePeriod(rawValues, variable);
      results.push({ point: batch[idx], value });
    });
  }

  return results;
}
