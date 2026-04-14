import type { GridPoint, MeteoVariable } from './types';
import { aggregatePeriod } from './aggregation';

export type OpenMeteoHost =
  | 'api.open-meteo.com'
  | 'historical-forecast-api.open-meteo.com'
  | 'archive-api.open-meteo.com';

const ARCHIVE_CUTOFF = '2022-01-01';
// Open-Meteo passe par nginx avec une limite d'URL ~8KB. À 500 points par call,
// l'URL atteint ~10KB → 414. À 250 points : ~3.5KB, marge confortable.
const MAX_POINTS_PER_CALL = 250;
// Sequentiel : Open-Meteo throttle aggressivement les bursts parallèles
// (429 "Minutely API request limit"). 7 calls séquentiels × ~700ms ≈ 5s.
const PARALLEL_BATCHES = 1;
// Retry simple sur 429 (rate limit) avec backoff
const RATE_LIMIT_RETRY_MS = 1500;

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

async function fetchOneBatch(
  batch: GridPoint[],
  host: OpenMeteoHost,
  variable: MeteoVariable,
  startDate: string,
  endDate: string,
): Promise<PointWeatherResult[]> {
  const url = buildOpenMeteoUrl(host, batch, variable, startDate, endDate);
  let res = await fetch(url);
  // Retry une fois sur 429 (rate limit minutely)
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT_RETRY_MS));
    res = await fetch(url);
  }
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
  return list.map((entry, idx) => {
    const hourly = entry.hourly ?? {};
    const rawValues =
      (hourly[variable] as (number | null)[] | undefined) ?? [];
    return { point: batch[idx], value: aggregatePeriod(rawValues, variable) };
  });
}

export async function fetchWeatherForPoints(
  points: GridPoint[],
  variable: MeteoVariable,
  startDate: string,
  endDate: string,
): Promise<PointWeatherResult[]> {
  if (points.length === 0) return [];

  const host = pickHost(startDate, endDate);

  // Découpe en batchs de MAX_POINTS_PER_CALL points
  const batches: GridPoint[][] = [];
  for (let i = 0; i < points.length; i += MAX_POINTS_PER_CALL) {
    batches.push(points.slice(i, i + MAX_POINTS_PER_CALL));
  }

  // Exécute les batchs par vagues parallèles de PARALLEL_BATCHES
  const results: PointWeatherResult[] = [];
  for (let i = 0; i < batches.length; i += PARALLEL_BATCHES) {
    const wave = batches.slice(i, i + PARALLEL_BATCHES);
    const waveResults = await Promise.all(
      wave.map((b) => fetchOneBatch(b, host, variable, startDate, endDate)),
    );
    for (const r of waveResults) results.push(...r);
  }

  return results;
}
