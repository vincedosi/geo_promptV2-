/**
 * GEOMATIK — API /api/digital/[campaignId]/meteo
 * Croisement campagne DSP × grille de zones météo dynamiques (Open-Meteo)
 * → GeoJSON + summary + meta (stats période)
 *
 * Flow serveur :
 *   1. Validation des params (Zod)
 *   2. Bbox de la campagne via RPC get_digital_campaign_bbox
 *   3. Génération d'une grille de points (résolution adaptative)
 *   4. Appel Open-Meteo en bulk → 1 valeur par point agrégée sur la période
 *   5. Construction des carrés GeoJSON avec weather_value
 *   6. Appel RPC get_digital_meteo_aggregation pour l'intersection spatiale
 *   7. Enrichissement des features avec label qualitatif + unité
 */
import { NextRequest, NextResponse } from 'next/server';
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

const ALLOWED_POP_FIELDS = [
  'population',
  'pop_0_14',
  'pop_15_29',
  'pop_30_44',
  'pop_45_59',
  'pop_60_74',
  'pop_75_plus',
] as const;

const QuerySchema = z.object({
  variable: z.enum([
    'precipitation',
    'temperature_2m',
    'windspeed_10m',
    'sunshine_duration',
  ]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be YYYY-MM-DD'),
  popField: z.enum(ALLOWED_POP_FIELDS).default('population'),
  metric: z.enum(['impressions', 'unique']).default('impressions'),
  resolution: z.coerce.number().min(0.05).max(1).optional(),
});

const MAX_HISTORY_DAYS = 90;
const MAX_FORECAST_DAYS = 16;
const MAX_POINTS = 400;
const DEFAULT_RESOLUTION = 0.1;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.round(ms / 86400000);
}

interface MeteoZoneRow {
  id: string;
  weather_value: number;
  total_impressions: number;
  pop_value: number | null;
  ratio: number | null;
  geometry: GeoJSON.Geometry;
}

interface MeteoRpcResult {
  zones: MeteoZoneRow[];
  summary: {
    in_zone_impressions: number;
    total_impressions: number;
    pct_in_zone: number;
    total_zones: number;
    zones_with_impressions: number;
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  if (!campaignId) {
    return NextResponse.json({ error: 'campaignId required' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    variable: searchParams.get('variable'),
    startDate: searchParams.get('startDate'),
    endDate: searchParams.get('endDate'),
    popField: searchParams.get('popField') ?? 'population',
    metric: searchParams.get('metric') ?? 'impressions',
    resolution: searchParams.get('resolution') ?? undefined,
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

  if (isFuture) {
    if (daysBetween(today, q.endDate) > MAX_FORECAST_DAYS) {
      return NextResponse.json(
        { error: `Forecast limited to ${MAX_FORECAST_DAYS} days ahead of today` },
        { status: 400 },
      );
    }
  } else {
    if (daysBetween(q.startDate, q.endDate) > MAX_HISTORY_DAYS) {
      return NextResponse.json(
        { error: `History range limited to ${MAX_HISTORY_DAYS} days` },
        { status: 400 },
      );
    }
  }

  const supabase = createAdminClient();

  // 1. Bbox de la campagne
  const { data: bboxData, error: bboxError } = await supabase.rpc(
    'get_digital_campaign_bbox',
    { p_campaign_id: campaignId },
  );

  if (bboxError || !bboxData) {
    console.error('[digital/meteo] bbox error', bboxError?.message);
    return NextResponse.json(
      { error: 'Failed to compute campaign bbox', details: bboxError?.message },
      { status: 500 },
    );
  }

  const bbox = bboxData as [number, number, number, number];
  if (!Array.isArray(bbox) || bbox.length !== 4) {
    return NextResponse.json(
      { error: 'Invalid bbox returned by RPC' },
      { status: 500 },
    );
  }

  // 2. Grille adaptative
  const baseResolution = q.resolution ?? DEFAULT_RESOLUTION;
  const resolution = adaptiveResolution(bbox, baseResolution, MAX_POINTS);
  const gridPoints = generateGrid(bbox, resolution);

  if (gridPoints.length === 0) {
    return NextResponse.json(
      { error: 'Empty grid generated for campaign bbox' },
      { status: 500 },
    );
  }

  // 3. Fetch Open-Meteo
  let weatherResults;
  try {
    weatherResults = await fetchWeatherForPoints(
      gridPoints,
      q.variable as MeteoVariable,
      q.startDate,
      q.endDate,
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    console.error('[digital/meteo] Open-Meteo fetch failed', msg);
    return NextResponse.json(
      { error: 'Weather API unavailable', details: msg },
      { status: 502 },
    );
  }

  // 4. Construction de la FeatureCollection des carrés
  const squaresFc: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: weatherResults.map((r) => ({
      type: 'Feature',
      geometry: buildSquarePolygon(r.point, resolution),
      properties: {
        square_id: computeSquareId(r.point),
        weather_value: r.value,
      },
    })),
  };

  // 5. Agrégation spatiale via RPC
  const { data: aggData, error: aggError } = await supabase.rpc(
    'get_digital_meteo_aggregation',
    {
      p_campaign_id: campaignId,
      p_squares: squaresFc,
      p_pop_field: q.popField,
      p_metric: q.metric,
    },
  );

  if (aggError || !aggData) {
    console.error('[digital/meteo] aggregation error', aggError?.message);
    return NextResponse.json(
      { error: 'Spatial aggregation failed', details: aggError?.message },
      { status: 500 },
    );
  }

  // 6. Parsing du résultat RPC (peut être string JSON ou objet)
  let rpcResult: MeteoRpcResult;
  if (typeof aggData === 'string') {
    try {
      rpcResult = JSON.parse(aggData) as MeteoRpcResult;
    } catch {
      return NextResponse.json(
        { error: 'Invalid RPC response format' },
        { status: 500 },
      );
    }
  } else {
    rpcResult = aggData as MeteoRpcResult;
  }

  const zones = Array.isArray(rpcResult?.zones) ? rpcResult.zones : [];

  // 7. Calcul des stats à partir des valeurs météo brutes (tous les points)
  const rawValues = weatherResults.map((r) => r.value);
  const stats = computeStats(rawValues, q.variable as MeteoVariable);
  const unit = METEO_UNIT[q.variable as MeteoVariable];

  // 8. Conversion zones → FeatureCollection enrichie
  const fc: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: zones.map((z) => {
      const value = Number(z.weather_value ?? 0);
      return {
        type: 'Feature',
        geometry: z.geometry,
        properties: {
          id: z.id,
          code: z.id,
          nom: `Carré ${z.id}`,
          impressions: z.total_impressions,
          pop_value: z.pop_value,
          ratio: z.ratio,
          weather_value: value,
          weather_label: qualitativeLabel(value, stats, q.variable as MeteoVariable),
          weather_unit: unit,
        },
      };
    }),
  };

  const response = {
    geojson: fc,
    summary: rpcResult?.summary ?? null,
    meta: {
      variable: q.variable,
      unit,
      startDate: q.startDate,
      endDate: q.endDate,
      resolution,
      stats,
    },
  };

  return NextResponse.json(response, {
    headers: {
      'Cache-Control': `public, max-age=${isFuture ? 900 : 3600}`,
    },
  });
}
