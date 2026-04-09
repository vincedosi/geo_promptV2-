import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const ALLOWED_SOURCES = ['iris', 'carreaux'] as const;
type Source = (typeof ALLOWED_SOURCES)[number];

const ALLOWED_SCALES = ['iris', 'commune', 'departement', 'region'] as const;
type Scale = (typeof ALLOWED_SCALES)[number];

function computeStatsFromFeatures(features: Array<{ properties: { impressions: number; population_cible: number; normalized_index: number } }>) {
  let totalImpressions = 0;
  let totalPopulation = 0;
  let sousServies = 0;
  let surServies = 0;
  let equilibrees = 0;
  const indices: number[] = [];

  for (const f of features) {
    const p = f.properties;
    totalImpressions += p.impressions;
    totalPopulation += p.population_cible;
    const ni = p.normalized_index;
    if (ni != null && ni > 0) {
      indices.push(ni);
      if (ni < 0.7) sousServies++;
      else if (ni > 1.3) surServies++;
      else equilibrees++;
    }
  }

  // Compute median from sorted indices
  indices.sort((a, b) => a - b);
  const medianNorm = indices.length > 0 ? indices[Math.floor(indices.length / 2)] : 0;

  return {
    total_impressions: Math.round(totalImpressions),
    total_population: Math.round(totalPopulation),
    avg_equity: indices.length > 0 ? Math.round(indices.reduce((a, b) => a + b, 0) / indices.length * 100) / 100 : 0,
    median_equity: Math.round(medianNorm * 100) / 100,
    zones_sous_servies: sousServies,
    zones_sur_servies: surServies,
    zones_equilibrees: equilibrees,
    total_zones: features.length,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get('campaign_id');
  const populationField = searchParams.get('population_field') || 'population';
  const source = (searchParams.get('source') || 'iris') as Source;
  const bboxStr = searchParams.get('bbox');
  const scale = (searchParams.get('scale') || 'iris') as Scale;
  // For departement/region scales, always full (no bbox needed)
  const full = scale === 'departement' || scale === 'region' ? true : searchParams.get('full') === 'true';

  if (!campaignId) {
    return NextResponse.json({ error: 'campaign_id required' }, { status: 400 });
  }

  if (!ALLOWED_SOURCES.includes(source)) {
    return NextResponse.json({ error: `Invalid source. Allowed: ${ALLOWED_SOURCES.join(', ')}` }, { status: 400 });
  }

  if (!ALLOWED_SCALES.includes(scale)) {
    return NextResponse.json({ error: `Invalid scale. Allowed: ${ALLOWED_SCALES.join(', ')}` }, { status: 400 });
  }

  // bbox is required for carreaux and for non-full IRIS
  if (source === 'carreaux' && !bboxStr) {
    return NextResponse.json({ error: 'bbox is required for carreaux source' }, { status: 400 });
  }
  if (!full && !bboxStr) {
    return NextResponse.json({ error: 'bbox or full=true required' }, { status: 400 });
  }

  let bbox: number[] | null = null;
  if (bboxStr) {
    const parts = bboxStr.split(',').map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) {
      return NextResponse.json({ error: 'bbox must be xmin,ymin,xmax,ymax' }, { status: 400 });
    }
    bbox = parts;
  }

  try {
    const supabase = createAdminClient();

    // Fetch geo features
    const geoResult = await supabase.rpc('get_equity_analysis', {
      p_campaign_id: campaignId,
      p_source: source,
      p_population_field: populationField,
      p_bbox: bbox,
      p_full: full,
      p_scale: scale,
    });

    if (geoResult.error) {
      console.error('[equity-analysis] geo error:', geoResult.error);
      return NextResponse.json({ error: geoResult.error.message }, { status: 500 });
    }

    // For IRIS: also fetch stats from RPC (includes median_equity)
    let statsFromRpc: { median_equity?: number; [key: string]: unknown } | null = null;
    if (source === 'iris') {
      const statsResult = await supabase.rpc('get_equity_stats', {
        p_campaign_id: campaignId,
        p_source: source,
        p_population_field: populationField,
      });

      if (!statsResult.error && statsResult.data) {
        statsFromRpc = statsResult.data;
      }
    }

    const rows = geoResult.data || [];

    // Build features with raw equity_index
    let features = rows
      .filter((r: { geom: unknown }) => r.geom)
      .map((r: { code_iris: string; nom_commune: string; code_dept: string; impressions: number; population_cible: number; equity_index: number; geom: unknown }) => ({
        type: 'Feature' as const,
        properties: {
          code_iris: r.code_iris,
          nom_commune: r.nom_commune,
          code_dept: r.code_dept,
          impressions: Math.round(r.impressions ?? 0),
          population_cible: Math.round(r.population_cible ?? 0),
          equity_index: r.equity_index ?? 0,
          normalized_index: 0,
        },
        geometry: r.geom,
      }));

    // Compute median for normalization
    let medianEquity: number;
    if (source === 'iris' && statsFromRpc?.median_equity) {
      medianEquity = statsFromRpc.median_equity as number;
    } else {
      // Compute from features
      const indices = features
        .map((f: { properties: { equity_index: number } }) => f.properties.equity_index)
        .filter((v: number) => v > 0)
        .sort((a: number, b: number) => a - b);
      medianEquity = indices.length > 0 ? indices[Math.floor(indices.length / 2)] : 1;
    }

    // Normalize: zone_index / median → 1.0 = median
    if (medianEquity > 0) {
      features = features.map((f: { properties: { equity_index: number; normalized_index: number }; [key: string]: unknown }) => ({
        ...f,
        properties: {
          ...f.properties,
          normalized_index: Math.round((f.properties.equity_index / medianEquity) * 100) / 100,
        },
      }));
    }

    // Stats with normalized thresholds
    let stats;
    if (source === 'iris' && statsFromRpc) {
      // Recompute zone counts with normalized thresholds
      let sousServies = 0, surServies = 0, equilibrees = 0;
      for (const f of features) {
        const ni = f.properties.normalized_index;
        if (ni < 0.7) sousServies++;
        else if (ni > 1.3) surServies++;
        else equilibrees++;
      }
      stats = {
        ...statsFromRpc,
        median_equity: medianEquity,
        zones_sous_servies: sousServies,
        zones_sur_servies: surServies,
        zones_equilibrees: equilibrees,
      };
    } else {
      stats = computeStatsFromFeatures(features);
    }

    return NextResponse.json({
      type: 'FeatureCollection',
      features,
      stats,
      median_equity: medianEquity,
    }, {
      headers: { 'Cache-Control': 'public, max-age=120' },
    });
  } catch (err) {
    console.error('[equity-analysis] unexpected error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
