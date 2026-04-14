/**
 * GEOMATIK — API /api/digital/[campaignId]/meteo (SSE streaming)
 * Grille météo dynamique Open-Meteo pour la 3ème carte de la page analyse digital.
 *
 * Flow serveur :
 *   1. Validation des params (Zod)
 *   2. Cache lookup (digital_meteo_cache) → hit = done immédiat
 *   3. Miss : bbox campagne → grille → filtre France → Open-Meteo batché
 *      avec events SSE `progress` après chaque batch
 *   4. Cache write → done final
 *
 * Events SSE :
 *   {type:'init', total:N, cached:false}
 *   {type:'progress', completed:M, total:N}
 *   {type:'done', geojson, meta, cached:boolean}
 *   {type:'error', message}
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import {
  generateGrid,
  buildSquarePolygon,
  computeSquareId,
  adaptiveResolution,
} from '@/lib/meteo/grid';
import { fetchWeatherForPoints } from '@/lib/meteo/open-meteo-client';
import { computeStats, qualitativeLabel } from '@/lib/meteo/aggregation';
import { METEO_UNIT } from '@/lib/meteo/types';
import type { MeteoVariable } from '@/lib/meteo/types';

export const dynamic = 'force-dynamic';

const QuerySchema = z.object({
  variable: z.enum([
    'precipitation',
    'temperature_2m',
    'windspeed_10m',
    'sunshine_duration',
  ]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be YYYY-MM-DD'),
  resolution: z.coerce.number().min(0.05).max(1).optional(),
});

const MAX_HISTORY_DAYS = 90;
const MAX_FORECAST_DAYS = 16;
// 0.13° ≈ 14 km/carré → ~3800 pts France.
// Contrainte Open-Meteo free tier : quota hourly 5000 calls/heure, chaque coord
// = 1 call. Rester sous 5000 points permet qu'un premier fetch complet tienne
// dans un créneau horaire. Après 1er hit → cache DB → réponses instantanées.
const DEFAULT_RESOLUTION = 0.13;
const MAX_POINTS = 10000;

type MeteoEvent =
  | { type: 'init'; total: number; cached: boolean }
  | { type: 'progress'; completed: number; total: number }
  | {
      type: 'done';
      geojson: GeoJSON.FeatureCollection;
      meta: unknown;
      cached: boolean;
    }
  | { type: 'error'; message: string };

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.round(ms / 86400000);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  if (!campaignId) {
    return new Response(JSON.stringify({ error: 'campaignId required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { searchParams } = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    variable: searchParams.get('variable'),
    startDate: searchParams.get('startDate'),
    endDate: searchParams.get('endDate'),
    resolution: searchParams.get('resolution') ?? undefined,
  });

  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Invalid query', details: parsed.error.flatten() }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const q = parsed.data;

  if (q.startDate > q.endDate) {
    return new Response(
      JSON.stringify({ error: 'startDate must be <= endDate' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const today = todayStr();
  const isFuture = q.endDate >= today;

  if (isFuture) {
    if (daysBetween(today, q.endDate) > MAX_FORECAST_DAYS) {
      return new Response(
        JSON.stringify({
          error: `Forecast limited to ${MAX_FORECAST_DAYS} days ahead of today`,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
  } else {
    if (daysBetween(q.startDate, q.endDate) > MAX_HISTORY_DAYS) {
      return new Response(
        JSON.stringify({
          error: `History range limited to ${MAX_HISTORY_DAYS} days`,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (evt: MeteoEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
      };

      try {
        const supabase = createAdminClient();
        const requestedResolution = q.resolution ?? DEFAULT_RESOLUTION;

        // ── 1. Cache lookup ──────────────────────────────────────────────
        const { data: cached } = await supabase
          .from('digital_meteo_cache')
          .select('payload, points_count')
          .eq('campaign_id', campaignId)
          .eq('variable', q.variable)
          .eq('start_date', q.startDate)
          .eq('end_date', q.endDate)
          .eq('resolution', requestedResolution)
          .maybeSingle();

        if (cached && cached.payload) {
          const payload = cached.payload as {
            geojson: GeoJSON.FeatureCollection;
            meta: unknown;
          };
          console.log(
            `[digital/meteo] cache HIT campaign=${campaignId} var=${q.variable} pts=${cached.points_count}`,
          );
          send({
            type: 'init',
            total: cached.points_count ?? 0,
            cached: true,
          });
          send({
            type: 'done',
            geojson: payload.geojson,
            meta: payload.meta,
            cached: true,
          });
          controller.close();
          return;
        }

        // ── 2. Bbox campagne ─────────────────────────────────────────────
        const { data: bboxData, error: bboxError } = await supabase.rpc(
          'get_digital_campaign_bbox',
          { p_campaign_id: campaignId },
        );

        if (bboxError || !bboxData) {
          send({
            type: 'error',
            message: `Failed to compute campaign bbox: ${bboxError?.message ?? 'unknown'}`,
          });
          controller.close();
          return;
        }

        const bbox = bboxData as [number, number, number, number];
        if (!Array.isArray(bbox) || bbox.length !== 4) {
          send({ type: 'error', message: 'Invalid bbox returned by RPC' });
          controller.close();
          return;
        }

        // ── 3. Grille adaptative sur bbox rectangulaire ──────────────────
        const resolution = adaptiveResolution(bbox, requestedResolution, MAX_POINTS);
        const rawGridPoints = generateGrid(bbox, resolution);

        if (rawGridPoints.length === 0) {
          send({ type: 'error', message: 'Empty grid generated for campaign bbox' });
          controller.close();
          return;
        }

        // ── 4. Filtre France (PostGIS) ───────────────────────────────────
        const { data: filteredData, error: filterError } = await supabase.rpc(
          'filter_points_in_france',
          { p_points: rawGridPoints },
        );

        if (filterError) {
          send({
            type: 'error',
            message: `Failed to filter grid to France: ${filterError.message}`,
          });
          controller.close();
          return;
        }

        const gridPoints =
          (filteredData as Array<{ lon: number; lat: number }> | null) ?? [];
        if (gridPoints.length === 0) {
          send({ type: 'error', message: 'No grid points fall inside France' });
          controller.close();
          return;
        }

        console.log(
          `[digital/meteo] cache MISS grid bbox=${rawGridPoints.length} → france=${gridPoints.length} pts (res=${resolution}°)`,
        );

        send({ type: 'init', total: gridPoints.length, cached: false });

        // ── 5. Fetch Open-Meteo avec progress par batch ──────────────────
        let weatherResults;
        try {
          weatherResults = await fetchWeatherForPoints(
            gridPoints,
            q.variable as MeteoVariable,
            q.startDate,
            q.endDate,
            (progress) => {
              send({
                type: 'progress',
                completed: progress.completed,
                total: progress.total,
              });
            },
          );
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : 'unknown error';
          console.error('[digital/meteo] Open-Meteo fetch failed', msg);
          send({ type: 'error', message: `Weather API unavailable: ${msg}` });
          controller.close();
          return;
        }

        // ── 6. Stats + FeatureCollection ─────────────────────────────────
        const rawValues = weatherResults.map((r) => r.value);
        const stats = computeStats(rawValues, q.variable as MeteoVariable);
        const unit = METEO_UNIT[q.variable as MeteoVariable];

        const fc: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: weatherResults.map((r) => {
            const squareId = computeSquareId(r.point);
            return {
              type: 'Feature',
              geometry: buildSquarePolygon(r.point, resolution),
              properties: {
                id: squareId,
                code: squareId,
                nom: `Carré ${squareId}`,
                weather_value: r.value,
                weather_label: qualitativeLabel(
                  r.value,
                  stats,
                  q.variable as MeteoVariable,
                ),
                weather_unit: unit,
              },
            };
          }),
        };

        const meta = {
          variable: q.variable,
          unit,
          startDate: q.startDate,
          endDate: q.endDate,
          resolution,
          stats,
        };

        // ── 7. Cache write (fire-and-forget, ne bloque pas le stream) ────
        const payload = { geojson: fc, meta };
        supabase
          .from('digital_meteo_cache')
          .upsert(
            {
              campaign_id: campaignId,
              variable: q.variable,
              start_date: q.startDate,
              end_date: q.endDate,
              resolution: requestedResolution,
              payload,
              points_count: gridPoints.length,
            },
            {
              onConflict: 'campaign_id,variable,start_date,end_date,resolution',
            },
          )
          .then(({ error }) => {
            if (error) {
              console.error('[digital/meteo] cache write failed', error.message);
            } else {
              console.log(
                `[digital/meteo] cache WRITE ok pts=${gridPoints.length}`,
              );
            }
          });

        send({ type: 'done', geojson: fc, meta, cached: false });
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        console.error('[digital/meteo] stream error', msg);
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`,
            ),
          );
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
