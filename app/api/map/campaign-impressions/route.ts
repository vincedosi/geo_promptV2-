import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get('campaign_id');
  const bboxStr = searchParams.get('bbox');
  const full = searchParams.get('full') === 'true';

  if (!campaignId) {
    return NextResponse.json({ error: 'campaign_id required' }, { status: 400 });
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
    const { data: rows, error } = await supabase.rpc('get_campaign_impressions', {
      p_campaign_id: campaignId,
      p_bbox: bbox,
      p_full: full,
    });

    if (error) {
      console.error('[campaign-impressions] error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const features = (rows || [])
      .filter((r: { geom: unknown }) => r.geom)
      .map((r: { code_iris: string; nom_commune: string; code_dept: string; impressions: number; geom: unknown }) => ({
        type: 'Feature' as const,
        properties: {
          code_iris: r.code_iris,
          nom_commune: r.nom_commune,
          code_dept: r.code_dept,
          impressions: Math.round(r.impressions ?? 0),
        },
        geometry: r.geom,
      }));

    // Compute stats
    let totalImpressions = 0;
    let maxImpressions = 0;
    for (const f of features) {
      totalImpressions += f.properties.impressions;
      if (f.properties.impressions > maxImpressions) maxImpressions = f.properties.impressions;
    }

    const topZones = [...features]
      .sort((a: { properties: { impressions: number } }, b: { properties: { impressions: number } }) => b.properties.impressions - a.properties.impressions)
      .slice(0, 5)
      .map((f: { properties: { code_iris: string; nom_commune: string; impressions: number } }) => ({
        code_iris: f.properties.code_iris,
        nom_commune: f.properties.nom_commune,
        impressions: f.properties.impressions,
      }));

    return NextResponse.json({
      type: 'FeatureCollection',
      features,
      stats: {
        total_impressions: Math.round(totalImpressions),
        zones_count: features.length,
        max_impressions: maxImpressions,
        top_zones: topZones,
      },
    }, {
      headers: { 'Cache-Control': 'public, max-age=120' },
    });
  } catch (err) {
    console.error('[campaign-impressions] unexpected:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
