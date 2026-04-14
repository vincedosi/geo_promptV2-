/**
 * GEOMATIK — API /api/digital/[campaignId]/meteo
 * Grille météo dynamique Open-Meteo pour la 3ème carte de la page analyse digital.
 *
 * Flow serveur :
 *   1. Validation des params (Zod)
 *   2. Bbox de la campagne via RPC get_digital_campaign_bbox
 *   3. Génération d'une grille de points (résolution adaptative)
 *   4. Appel Open-Meteo en bulk → 1 valeur par point agrégée sur la période
 *   5. Construction du GeoJSON (carrés + weather_value + label qualitatif)
 *
 * Note: pas d'agrégation spatiale DSP ici. La 3ème carte affiche uniquement
 * les zones météo coloriées par la variable sélectionnée (palette météo).
 * Les cartes Impressions et Ratio continuent d'utiliser /api/digital/[id]/map.
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
// MAX_POINTS = limite avant l'application du filtre France (sur la bbox rectangulaire).
// 4000 autorise une résolution de 0.2° sur la France métropolitaine entière sans
// que adaptiveResolution ne double automatiquement.
const MAX_POINTS = 4000;
// Résolution par défaut en degrés. 0.2° ≈ 22 km par carré, sweet spot lisibilité/perf :
// ~3300 points sur bbox France → ~1700 après clip → ~4 appels Open-Meteo (~3-4s).
const DEFAULT_RESOLUTION = 0.2;

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
    return NextResponse.json({ error: 'campaignId required' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    variable: searchParams.get('variable'),
    startDate: searchParams.get('startDate'),
    endDate: searchParams.get('endDate'),
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

  // 2. Grille adaptative (sur la bbox rectangulaire avant clip France)
  const baseResolution = q.resolution ?? DEFAULT_RESOLUTION;
  const resolution = adaptiveResolution(bbox, baseResolution, MAX_POINTS);
  const rawGridPoints = generateGrid(bbox, resolution);

  if (rawGridPoints.length === 0) {
    return NextResponse.json(
      { error: 'Empty grid generated for campaign bbox' },
      { status: 500 },
    );
  }

  // 3. Filtre France : ne garder que les points à l'intérieur de l'hexagone
  // via RPC PostGIS (france_boundary, 112 vertex, très rapide)
  const { data: filteredData, error: filterError } = await supabase.rpc(
    'filter_points_in_france',
    { p_points: rawGridPoints },
  );

  if (filterError) {
    console.error('[digital/meteo] filter_points_in_france error', filterError.message);
    return NextResponse.json(
      { error: 'Failed to filter grid to France', details: filterError.message },
      { status: 500 },
    );
  }

  const gridPoints = (filteredData as Array<{ lon: number; lat: number }> | null) ?? [];
  if (gridPoints.length === 0) {
    return NextResponse.json(
      { error: 'No grid points fall inside France' },
      { status: 500 },
    );
  }
  console.log(
    `[digital/meteo] grid: bbox=${rawGridPoints.length} pts → france=${gridPoints.length} pts (resolution=${resolution}°)`,
  );

  // 4. Fetch Open-Meteo (uniquement sur les points français)
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

  // 4. Calcul des stats sur toutes les valeurs brutes (pour légende + labels)
  const rawValues = weatherResults.map((r) => r.value);
  const stats = computeStats(rawValues, q.variable as MeteoVariable);
  const unit = METEO_UNIT[q.variable as MeteoVariable];

  // 5. Construction directe de la FeatureCollection finale
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
          weather_label: qualitativeLabel(r.value, stats, q.variable as MeteoVariable),
          weather_unit: unit,
        },
      };
    }),
  };

  const response = {
    geojson: fc,
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
