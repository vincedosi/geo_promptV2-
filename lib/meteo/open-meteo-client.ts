import type { GridPoint, MeteoVariable } from './types';
import { aggregatePeriod } from './aggregation';

export type OpenMeteoHost =
  | 'api.open-meteo.com'
  | 'historical-forecast-api.open-meteo.com'
  | 'archive-api.open-meteo.com';

const ARCHIVE_CUTOFF = '2022-01-01';
// Open-Meteo passe par nginx avec une limite d'URL ~8KB.
// 250 points → URL ~5KB, marge safe. 300+ = risque 414.
const MAX_POINTS_PER_CALL = 250;
// Séquentiel strict : Open-Meteo applique un quota "minutely" qui compte
// chaque coordonnée comme 1 call (600 calls/minute free tier). Les bursts
// parallèles déclenchent 429 instantanément, même sur petit volume.
const PARALLEL_BATCHES = 1;
// Délai entre batchs pour lisser le débit (≈ 1 batch/sec → ~250 coord/sec).
const INTER_BATCH_DELAY_MS = 1000;
// Retry exponentiel sur 429 : 5s, 20s, 60s. Couvre le reset de la fenêtre
// "minutely" d'Open-Meteo dans la plupart des cas.
const RATE_LIMIT_BACKOFFS_MS = [5000, 20000, 60000];

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

export interface FetchProgress {
  completed: number;
  total: number;
}

export type ProgressCallback = (progress: FetchProgress) => void;

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

  // Retry exponentiel sur 429 : Open-Meteo a une fenêtre minutely glissante.
  for (const backoff of RATE_LIMIT_BACKOFFS_MS) {
    if (res.status !== 429) break;
    console.warn(
      `[open-meteo] 429 rate limit, waiting ${backoff}ms before retry`,
    );
    await new Promise((r) => setTimeout(r, backoff));
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
  onProgress?: ProgressCallback,
): Promise<PointWeatherResult[]> {
  if (points.length === 0) return [];

  const host = pickHost(startDate, endDate);
  const total = points.length;

  // Découpe en batchs de MAX_POINTS_PER_CALL points
  const batches: GridPoint[][] = [];
  for (let i = 0; i < points.length; i += MAX_POINTS_PER_CALL) {
    batches.push(points.slice(i, i + MAX_POINTS_PER_CALL));
  }

  // Progress initial (pour que le client voie 0/total dès le début)
  onProgress?.({ completed: 0, total });

  // Exécute les batchs par vagues parallèles de PARALLEL_BATCHES,
  // avec un délai entre vagues pour lisser la charge sous la limite minutely.
  const results: PointWeatherResult[] = [];
  for (let i = 0; i < batches.length; i += PARALLEL_BATCHES) {
    if (i > 0 && INTER_BATCH_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, INTER_BATCH_DELAY_MS));
    }
    const wave = batches.slice(i, i + PARALLEL_BATCHES);
    const waveResults = await Promise.all(
      wave.map((b) => fetchOneBatch(b, host, variable, startDate, endDate)),
    );
    for (const r of waveResults) results.push(...r);
    onProgress?.({ completed: results.length, total });
  }

  return results;
}
