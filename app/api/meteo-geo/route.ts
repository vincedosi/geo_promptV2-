/**
 * MAGELIAN — API /api/meteo-geo
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
import { logger } from '@/lib/logger';
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
// L'échantillonnage spatial garantit 1 seul batch (≤500 points) quelle que
// soit l'échelle → quelques secondes. maxDuration large par sécurité (retries 429).
export const maxDuration = 300;

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
  // Viewport optionnel (mode cp) : "west,south,east,north" — restreint les
  // zones interrogées à la vue carte pour rester sous 1 batch Open-Meteo.
  bbox: z.string().regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/).optional(),
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

interface QueryPoint {
  lat: number;
  lon: number;
}

/**
 * Échantillonnage spatial : regroupe les zones sur une grille adaptative pour
 * ne jamais dépasser maxPoints appels Open-Meteo (1 batch = quelques secondes,
 * au lieu de 13 batchs espacés de 62 s pour les 6 187 CP).
 * Perte de précision négligeable : le modèle Open-Meteo est à ~11-25 km de
 * résolution — interroger chaque CP revient à répéter la même valeur.
 * Retourne les points à interroger + l'index du point assigné à chaque zone.
 */
function sampleZonePoints(
  zones: ZoneCentroid[],
  maxPoints: number,
): { points: QueryPoint[]; assign: number[] } {
  if (zones.length <= maxPoints) {
    return {
      points: zones.map((z) => ({ lat: z.lat, lon: z.lon })),
      assign: zones.map((_, i) => i),
    };
  }
  const buildCells = (step: number): Map<string, number[]> => {
    const m = new Map<string, number[]>();
    zones.forEach((z, i) => {
      const k = `${Math.round(z.lat / step)}:${Math.round(z.lon / step)}`;
      const arr = m.get(k);
      if (arr) arr.push(i);
      else m.set(k, [i]);
    });
    return m;
  };
  let step = 0.1;
  let cells = buildCells(step);
  while (cells.size > maxPoints) {
    step *= 1.4;
    cells = buildCells(step);
  }
  const points: QueryPoint[] = [];
  const assign = new Array<number>(zones.length).fill(0);
  for (const idxs of cells.values()) {
    const lat = idxs.reduce((s, i) => s + zones[i].lat, 0) / idxs.length;
    const lon = idxs.reduce((s, i) => s + zones[i].lon, 0) / idxs.length;
    const p = points.length;
    points.push({ lat, lon });
    for (const i of idxs) assign[i] = p;
  }
  return { points, assign };
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
  zones: QueryPoint[],
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
  zones: QueryPoint[],
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
    // Quota horaire/journalier épuisé : retenter ne sert à rien (fenêtre d'une
    // heure) — on échoue immédiatement avec un message clair au lieu de faire
    // patienter ~105 s de backoffs. Seul le rate limit minute vaut un retry.
    const body = await res.text().catch(() => '');
    if (/hourly|daily/i.test(body)) {
      throw new Error(
        'Quota horaire Open-Meteo épuisé — réessayez dans l\'heure. ' +
        '(Les données déjà chargées restent en cache 24 h.)',
      );
    }
    console.warn(`[meteo-geo] 429 rate limit (minute), retrying in ${ms}ms`);
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

function getCacheKey(scale: string, variable: string, startDate: string, endDate: string, bbox?: string): string {
  // bbox arrondie au demi-degré : limite la fragmentation du cache quand la
  // vue carte bouge légèrement entre deux applications.
  const bboxKey = bbox
    ? bbox.split(',').map((v) => (Math.round(parseFloat(v) * 2) / 2).toFixed(1)).join(',')
    : '';
  return createHash('md5').update(`v2-${scale}-${variable}-${startDate}-${endDate}-${bboxKey}`).digest('hex');
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
    bbox: searchParams.get('bbox') ?? undefined,
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
  const cacheKey = getCacheKey(q.scale, q.variable, q.startDate, q.endDate, q.bbox);

  // ── Cache lookup ─────────────────────────────────────────────────────
  const cached = await readCacheFile(cacheKey, isFuture);
  if (cached) {
    logger.debug('meteo-geo', `cache HIT ${q.scale}/${q.variable} ${q.startDate}→${q.endDate}`);
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
  let zones = zonesRaw as ZoneCentroid[];
  if (zones.length === 0) {
    return NextResponse.json({ error: 'No zones found for scale' }, { status: 500 });
  }

  // ── Restriction au viewport (mode cp) ────────────────────────────────
  // Si la vue est hors de France (aucune zone), on retombe sur la France entière.
  if (q.bbox && scale === 'cp') {
    const [w, s, e, n] = q.bbox.split(',').map(parseFloat);
    const scoped = zones.filter((z) => z.lon >= w && z.lon <= e && z.lat >= s && z.lat <= n);
    if (scoped.length > 0) zones = scoped;
  }

  // ── Échantillonnage spatial → toujours 1 seul batch Open-Meteo ───────
  const { points, assign } = sampleZonePoints(zones, MAX_POINTS_PER_BATCH);

  // ── Batchs ───────────────────────────────────────────────────────────
  const batches: QueryPoint[][] = [];
  for (let i = 0; i < points.length; i += MAX_POINTS_PER_BATCH) {
    batches.push(points.slice(i, i + MAX_POINTS_PER_BATCH));
  }
  const totalBatches = batches.length;
  logger.debug('meteo-geo', `cache MISS ${q.scale}/${q.variable} zones=${zones.length} points=${points.length} batches=${totalBatches}`);

  // ── Streaming NDJSON ─────────────────────────────────────────────────
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const pointValues: number[] = [];

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
          pointValues.push(...values);

          // Délai inter-batch pour le mode CP (pas de délai si un seul batch)
          if (i < totalBatches - 1 && totalBatches > 1) {
            await new Promise((r) => setTimeout(r, INTER_BATCH_DELAY_MS));
          }
        }

        // Valeur par zone : chaque zone reçoit la valeur de son point échantillonné
        const zoneValues = zones.map((_, i) => pointValues[assign[i]]);

        // Stats + unit (sunshine_duration affiché en heures) — calculées par
        // zone (et non par point) pour des quantiles fidèles à la choroplèthe.
        const stats = computeStats(zoneValues, variable);
        const unit = variable === 'sunshine_duration' ? 'h' : METEO_UNIT[variable];
        stats.unit = unit;

        // Mapping code → valeur
        const data: Record<string, MeteoZoneValue> = {};
        for (let i = 0; i < zones.length; i++) {
          const value = zoneValues[i];
          data[zones[i].code] = {
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
          totalZones: zones.length,
          batchesTotal: totalBatches,
          sampledPoints: points.length,
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
