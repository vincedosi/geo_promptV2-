import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const ALLOWED_FIELDS = ['population', 'pop_15_29', 'pop_30_44', 'nb_csp_cadre', 'nb_diplome_sup', 'rev_median', 'taux_proprio', 'nb_menages'];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get('campaign_id');
  const populationField = searchParams.get('population_field') || 'population';
  const bboxStr = searchParams.get('bbox');

  if (!campaignId) {
    return NextResponse.json({ error: 'campaign_id required' }, { status: 400 });
  }

  if (!ALLOWED_FIELDS.includes(populationField)) {
    return NextResponse.json({ error: `Invalid population_field. Allowed: ${ALLOWED_FIELDS.join(', ')}` }, { status: 400 });
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

    const [geoResult, statsResult] = await Promise.all([
      supabase.rpc('get_equity_analysis', {
        p_campaign_id: campaignId,
        p_population_field: populationField,
        p_bbox: bbox,
      }),
      supabase.rpc('get_equity_stats', {
        p_campaign_id: campaignId,
        p_population_field: populationField,
      }),
    ]);

    if (geoResult.error) {
      console.error('[equity-analysis] geo error:', geoResult.error);
      return NextResponse.json({ error: geoResult.error.message }, { status: 500 });
    }

    if (statsResult.error) {
      console.error('[equity-analysis] stats error:', statsResult.error);
      return NextResponse.json({ error: statsResult.error.message }, { status: 500 });
    }

    const rows = geoResult.data || [];
    const stats = statsResult.data || {
      total_impressions: 0, total_population: 0, avg_equity: 0,
      zones_sous_servies: 0, zones_sur_servies: 0, zones_equilibrees: 0, total_zones: 0,
    };

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
