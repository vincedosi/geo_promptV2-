import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const ALLOWED_FIELDS = ['population', 'pop_15_29', 'pop_30_44', 'nb_csp_cadre', 'nb_diplome_sup', 'rev_median', 'taux_proprio', 'nb_menages'];
const ALLOWED_SOURCES = ['iris', 'carreaux'] as const;
type Source = (typeof ALLOWED_SOURCES)[number];

// For carreaux: compute stats from features (stats RPC too heavy for Nano)
function computeStatsFromFeatures(features: Array<{ properties: { impressions: number; population_cible: number; equity_index: number } }>) {
  let totalImpressions = 0;
  let totalPopulation = 0;
  let equitySum = 0;
  let equityCount = 0;
  let sousServies = 0;
  let surServies = 0;
  let equilibrees = 0;

  for (const f of features) {
    const p = f.properties;
    totalImpressions += p.impressions;
    totalPopulation += p.population_cible;
    if (p.equity_index != null) {
      equitySum += p.equity_index;
      equityCount++;
      if (p.equity_index < 0.5) sousServies++;
      else if (p.equity_index > 2.0) surServies++;
      else equilibrees++;
    }
  }

  return {
    total_impressions: Math.round(totalImpressions),
    total_population: Math.round(totalPopulation),
    avg_equity: equityCount > 0 ? Math.round(equitySum / equityCount * 100) / 100 : 0,
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

  if (!campaignId) {
    return NextResponse.json({ error: 'campaign_id required' }, { status: 400 });
  }

  if (!ALLOWED_SOURCES.includes(source)) {
    return NextResponse.json({ error: `Invalid source. Allowed: ${ALLOWED_SOURCES.join(', ')}` }, { status: 400 });
  }

  if (!ALLOWED_FIELDS.includes(populationField)) {
    return NextResponse.json({ error: `Invalid population_field. Allowed: ${ALLOWED_FIELDS.join(', ')}` }, { status: 400 });
  }

  // bbox is required for carreaux (too heavy without viewport filter)
  if (source === 'carreaux' && !bboxStr) {
    return NextResponse.json({ error: 'bbox is required for carreaux source' }, { status: 400 });
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
    });

    if (geoResult.error) {
      console.error('[equity-analysis] geo error:', geoResult.error);
      return NextResponse.json({ error: geoResult.error.message }, { status: 500 });
    }

    // For IRIS: also fetch stats from RPC
    let statsFromRpc: Record<string, unknown> | null = null;
    if (source === 'iris') {
      const statsResult = await supabase.rpc('get_equity_stats', {
        p_campaign_id: campaignId,
        p_source: source,
        p_population_field: populationField,
      });

      if (statsResult.error) {
        console.error('[equity-analysis] stats error:', statsResult.error);
        return NextResponse.json({ error: statsResult.error.message }, { status: 500 });
      }

      statsFromRpc = statsResult.data || null;
    }

    const rows = geoResult.data || [];

    const features = rows
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
        },
        geometry: r.geom,
      }));

    // Compute stats: from RPC for IRIS, from features for carreaux
    const defaultStats = {
      total_impressions: 0, total_population: 0, avg_equity: 0,
      zones_sous_servies: 0, zones_sur_servies: 0, zones_equilibrees: 0, total_zones: 0,
    };

    const stats = source === 'carreaux'
      ? computeStatsFromFeatures(features)
      : (statsFromRpc || defaultStats);

    return NextResponse.json({
      type: 'FeatureCollection',
      features,
      stats,
    }, {
      headers: { 'Cache-Control': 'public, max-age=120' },
    });
  } catch (err) {
    console.error('[equity-analysis] unexpected error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
