/**
 * GEOMATIK — API /api/meteo-geo
 *
 * Météo Open-Meteo agrégée par zones admin (régions, départements, codes postaux).
 * Un point par zone = centroïde pré-calculé dans ref_regions/ref_departements/ref_codes_postaux.
 *
 * Flow serveur :
 *   1. Validation des params (Zod)
 *   2. Cache filesystem lookup (md5 scale+variable+dates)
 *   3. RPC get_zone_centroids(scale) → liste de {code, nom, lat, lon}
 *   4. Batchs de 500 points max vers Open-Meteo, NDJSON streaming de progression
 *   5. Cache filesystem write
 *
 * Format de réponse : NDJSON (toujours), 1 ligne par chunk.
 *   {"status":"fetching","progress":0,"total":13}
 *   {"status":"fetching","progress":1,"total":13}
 *   ...
 *   {"status":"done","progress":13,"total":13,"data":{...},"meta":{...}}
 *
 * Pour region (1 batch) / departement (1 batch) le stream a un seul chunk done.
 * Pour cp (~13 batchs) la progression est visible côté client sous forme de barre.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createHash } from 'crypto';
import { readFile, writeFile, mkdir, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { aggregatePeriod, computeStats, qualitativeLabel } from '@/lib/meteo/aggregation';
import { METEO_DAILY_FIELD, METEO_UNIT } from '@/lib/meteo/types';
import type {
  MeteoScale,
  MeteoVariable,
  MeteoZoneChunk,
  MeteoZoneMeta,
  MeteoZoneResponse,
  MeteoZoneValue,
} from '@/lib/meteo/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// CP mode (~13 batches × 62s) peut durer ~13 min en cold load.
// Vercel Pro autorise jusqu'à 900s (15 min). Hors Pro : réduire batch count.
export const maxDuration = 900;

const QuerySchema = z.object({
  scale: z.enum(['region', 'departement', 'cp']),
  variable: z.enum([
    'precipitation',
    'temperature_2m',
    'windspeed_10m',
    'sunshine_duration',
  ]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be YYYY-MM-DD'),
});

const MAX_HISTORY_DAYS = 90;
const MAX_FORECAST_DAYS = 16;
// URL nginx limit Open-Meteo ~8KB → 500 pts/batch (coord à 3 décimales, marge safe)
const MAX_POINTS_PER_BATCH = 500;
// Open-Meteo free tier quotas :
//   - minutely : 600 calls/min (rolling)
//   - hourly   : 5000 calls/h  (rolling) ← contrainte dure pour CP (6187 pts)
//   - daily    : 10000 calls/jour
// Chaque coord = 1 call. En mode CP (6187 pts / 500 = 13 batches) on envoie
// 6187 calls → dépasse le plafond horaire → le cold load peut bloquer vers
// batch 10. Le cache 24h évite de répéter l'incident après succès initial.
// Délai 62s entre batches = rester sous 600 calls/minute (500 < 600, reset
// de la fenêtre glissante après 60s).
const INTER_BATCH_DELAY_MS = 62_000;
// Retry long pour les 429 : wait up to 65s pour laisser la fenêtre minutely se libérer
const RATE_LIMIT_BACKOFFS_MS = [10_000, 30_000, 65_000];
const ARCHIVE_CUTOFF = '2022-01-01';

const CACHE_DIR = join(tmpdir(), 'meteo-cache');
const CACHE_TTL_HISTORY_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_FORECAST_MS = 60 * 60 * 1000;

interface ZoneCentroid {
  code: string;
  nom: string;
  lat: number;
  lon: number;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function pickHost(startDate: string, endDate: string): string {
  const today = todayStr();
  if (endDate >= today) return 'api.open-meteo.com';
  if (startDate < ARCHIVE_CUTOFF) return 'archive-api.open-meteo.com';
  return 'historical-forecast-api.open-meteo.com';
}

function buildOpenMeteoUrl(
  host: string,
  zones: ZoneCentroid[],
  variable: MeteoVariable,
  startDate: string,
  endDate: string,
): string {
  const endpoint = host === 'archive-api.open-meteo.com' ? '/v1/archive' : '/v1/forecast';
  const dailyField = METEO_DAILY_FIELD[variable];
  // Construction manuelle des query params : URLSearchParams encode les virgules
  // en %2C et triple la taille de la liste lat/lon → explosion URL 414.
  const latList = zones.map((z) => z.lat.toFixed(3)).join(',');
  const lonList = zones.map((z) => z.lon.toFixed(3)).join(',');
  return (
    `https://${host}${endpoint}` +
    `?latitude=${latList}` +
    `&longitude=${lonList}` +
    `&daily=${dailyField}` +
    `&start_date=${startDate}` +
    `&end_date=${endDate}` +
    `&timezone=${encodeURIComponent('Europe/Paris')}`
  );
}

interface OpenMeteoPointResponse {
  daily?: Record<string, unknown> & { time?: string[] };
}

async function fetchBatchFromOpenMeteo(
  zones: ZoneCentroid[],
  variable: MeteoVariable,
  startDate: string,
  endDate: string,
): Promise<number[]> {
  const host = pickHost(startDate, endDate);
  const url = buildOpenMeteoUrl(host, zones, variable, startDate, endDate);
  const dailyField = METEO_DAILY_FIELD[variable];

  let res = await fetch(url);
  for (const ms of RATE_LIMIT_BACKOFFS_MS) {
    if (res.status !== 429) break;
    console.warn(`[meteo-geo] 429 rate limit, retrying in ${ms}ms`);
    await new Promise((r) => setTimeout(r, ms));
    res = await fetch(url);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Open-Meteo ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as OpenMeteoPointResponse | OpenMeteoPointResponse[];
  const list: OpenMeteoPointResponse[] = Array.isArray(json) ? json : [json];
  return list.map((entry) => {
    const rawValues = (entry.daily?.[dailyField] as (number | null)[] | undefined) ?? [];
    let agg = aggregatePeriod(rawValues, variable);
    // Open-Meteo renvoie sunshine_duration en secondes → conversion en heures pour l'affichage
    if (variable === 'sunshine_duration') agg = agg / 3600;
    return agg;
  });
}

function getCacheKey(scale: string, variable: string, startDate: string, endDate: string): string {
  return createHash('md5').update(`${scale}-${variable}-${startDate}-${endDate}`).digest('hex');
}

async function readCacheFile(key: string, isForecast: boolean): Promise<MeteoZoneResponse | null> {
  try {
    const path = join(CACHE_DIR, `${key}.json`);
    const st = await stat(path);
    const ttl = isForecast ? CACHE_TTL_FORECAST_MS : CACHE_TTL_HISTORY_MS;
    if (Date.now() - st.mtimeMs > ttl) return null;
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content) as MeteoZoneResponse;
  } catch {
    return null;
  }
}

async function writeCacheFile(key: string, payload: MeteoZoneResponse): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const path = join(CACHE_DIR, `${key}.json`);
    await writeFile(path, JSON.stringify(payload));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    console.error('[meteo-geo] cache write failed', msg);
  }
}

function ndjsonLine(chunk: MeteoZoneChunk): string {
  return JSON.stringify(chunk) + '\n';
}

export async function GET(request: NextRequest): Promise<NextResponse | Response> {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { searchParams } = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    scale: searchParams.get('scale'),
    variable: searchParams.get('variable'),
    startDate: searchParams.get('startDate'),
    endDate: searchParams.get('endDate'),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const q = parsed.data;

  if (q.startDate > q.endDate) {
    return NextResponse.json(
      { error: 'startDate must be <= endDate' },
      { status: 400 },
    );
  }

  const today = todayStr();
  const isFuture = q.endDate >= today;
  if (isFuture && daysBetween(today, q.endDate) > MAX_FORECAST_DAYS) {
    return NextResponse.json(
      { error: `Forecast limited to ${MAX_FORECAST_DAYS} days ahead of today` },
      { status: 400 },
    );
  }
  if (!isFuture && daysBetween(q.startDate, q.endDate) > MAX_HISTORY_DAYS) {
    return NextResponse.json(
      { error: `History range limited to ${MAX_HISTORY_DAYS} days` },
      { status: 400 },
    );
  }

  const variable = q.variable as MeteoVariable;
  const scale = q.scale as MeteoScale;
  const cacheKey = getCacheKey(q.scale, q.variable, q.startDate, q.endDate);

  // ── Cache lookup ─────────────────────────────────────────────────────
  const cached = await readCacheFile(cacheKey, isFuture);
  if (cached) {
    console.log(`[meteo-geo] cache HIT ${q.scale}/${q.variable} ${q.startDate}→${q.endDate}`);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const chunk: MeteoZoneChunk = {
          status: 'done',
          progress: cached.meta.batchesTotal || 1,
          total: cached.meta.batchesTotal || 1,
          data: cached.data,
          meta: cached.meta,
        };
        controller.enqueue(encoder.encode(ndjsonLine(chunk)));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'X-Meteo-Cache': 'hit',
      },
    });
  }

  // ── Fetch centroïdes via RPC ─────────────────────────────────────────
  const supabase = createAdminClient();
  const { data: zonesRaw, error: rpcError } = await supabase.rpc('get_zone_centroids', {
    p_scale: q.scale,
  });
  if (rpcError || !zonesRaw) {
    console.error('[meteo-geo] get_zone_centroids error', rpcError?.message);
    return NextResponse.json(
      { error: 'Failed to fetch zone centroids', details: rpcError?.message },
      { status: 500 },
    );
  }
  const zones = zonesRaw as ZoneCentroid[];
  if (zones.length === 0) {
    return NextResponse.json({ error: 'No zones found for scale' }, { status: 500 });
  }

  // ── Batchs ───────────────────────────────────────────────────────────
  const batches: ZoneCentroid[][] = [];
  for (let i = 0; i < zones.length; i += MAX_POINTS_PER_BATCH) {
    batches.push(zones.slice(i, i + MAX_POINTS_PER_BATCH));
  }
  const totalBatches = batches.length;
  console.log(
    `[meteo-geo] cache MISS ${q.scale}/${q.variable} zones=${zones.length} batches=${totalBatches}`,
  );

  // ── Streaming NDJSON ─────────────────────────────────────────────────
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const allZones: ZoneCentroid[] = [];
        const allValues: number[] = [];

        for (let i = 0; i < totalBatches; i++) {
          // ETA : estimation grossière basée sur le délai inter-batch restant
          // (chaque batch ≈ 2-3s fetch + 62s wait). Pour le dernier batch, pas de wait.
          const remainingBatches = totalBatches - i;
          const etaMs = remainingBatches > 1
            ? (remainingBatches - 1) * INTER_BATCH_DELAY_MS + remainingBatches * 3000
            : 3000;

          controller.enqueue(
            encoder.encode(
              ndjsonLine({
                status: 'fetching',
                progress: i,
                total: totalBatches,
                etaMs,
              }),
            ),
          );

          const batch = batches[i];
          const values = await fetchBatchFromOpenMeteo(
            batch,
            variable,
            q.startDate,
            q.endDate,
          );
          allZones.push(...batch);
          allValues.push(...values);

          // Délai inter-batch pour le mode CP (pas de délai si un seul batch)
          if (i < totalBatches - 1 && totalBatches > 1) {
            await new Promise((r) => setTimeout(r, INTER_BATCH_DELAY_MS));
          }
        }

        // Stats + unit (sunshine_duration affiché en heures)
        const stats = computeStats(allValues, variable);
        const unit = variable === 'sunshine_duration' ? 'h' : METEO_UNIT[variable];
        stats.unit = unit;

        // Mapping code → valeur
        const data: Record<string, MeteoZoneValue> = {};
        for (let i = 0; i < allZones.length; i++) {
          const zone = allZones[i];
          const value = allValues[i];
          data[zone.code] = {
            value,
            unit,
            label: qualitativeLabel(value, stats, variable),
          };
        }

        const meta: MeteoZoneMeta = {
          variable,
          unit,
          startDate: q.startDate,
          endDate: q.endDate,
          scale,
          stats,
          totalZones: allZones.length,
          batchesTotal: totalBatches,
          cachedAt: null,
        };

        const payload: MeteoZoneResponse = { data, meta };

        // Cache fire-and-forget avec cachedAt pour les lectures futures
        void writeCacheFile(cacheKey, {
          data,
          meta: { ...meta, cachedAt: new Date().toISOString() },
        });

        // Chunk final
        controller.enqueue(
          encoder.encode(
            ndjsonLine({
              status: 'done',
              progress: totalBatches,
              total: totalBatches,
              data: payload.data,
              meta: payload.meta,
            }),
          ),
        );
        controller.close();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'unknown error';
        console.error('[meteo-geo] stream error', msg);
        controller.enqueue(
          encoder.encode(
            ndjsonLine({
              status: 'error',
              error: msg,
            }),
          ),
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'X-Meteo-Cache': 'miss',
      'X-Accel-Buffering': 'no',
    },
  });
}
