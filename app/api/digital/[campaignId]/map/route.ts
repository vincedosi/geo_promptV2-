/**
 * GET /api/digital/[campaignId]/map?bbox=xmin,ymin,xmax,ymax
 * Returns GeoJSON FeatureCollection of CP choropleth for a campaign.
 * Auth: requireAuth + scope org campagne.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { checkCampaignAccess } from '@/lib/campaigns/access';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { campaignId } = await params;
  const { searchParams } = new URL(request.url);
  const bboxStr = searchParams.get('bbox');

  if (!campaignId) {
    return NextResponse.json({ error: 'campaignId required' }, { status: 400 });
  }

  // Parse bbox (default: France métro)
  let xmin = -5.5, ymin = 41.0, xmax = 10.0, ymax = 51.5;
  if (bboxStr) {
    const parts = bboxStr.split(',').map(Number);
    if (parts.length === 4 && parts.every(n => !isNaN(n))) {
      [xmin, ymin, xmax, ymax] = parts;
    }
  }

  const scale = searchParams.get('scale') || 'cp';
  const popField = searchParams.get('pop_field') || 'population';
  const mediaStr = searchParams.get('media');
  const media = mediaStr ? mediaStr.split(',').filter(Boolean) : null;
  // Toujours via RPC v2 (paramétrée par metric_field arbitraire).
  // Aliasing pour rétrocompat URL bookmark / toggle legacy CampaignContextBar :
  //   - 'impressions'/'' (default) → tracked_ads SI campagne Adform, sinon 'impressions'
  //   - 'unique'                   → unique_impressions
  // Pour les autres DSP (TTD/DV360/...), 'impressions' reste la vraie colonne native.
  const metricRaw = (searchParams.get('metric') ?? '').trim();
  const supabase = createAdminClient();

  // Scope org : 404 uniforme (ne pas divulguer l'existence à une autre org).
  const access = await checkCampaignAccess(supabase, profile, campaignId);
  if (access !== 'ok') return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });

  let metricField = metricRaw || 'tracked_ads';
  if (metricRaw === 'unique') {
    metricField = 'unique_impressions';
  } else if (metricRaw === 'impressions' || metricRaw === '') {
    // Détecter Adform pour aliaser 'impressions' → 'tracked_ads' (legacy alias)
    const { data: camp } = await supabase
      .from('dsp_campaigns')
      .select('dsp_source')
      .eq('id', campaignId)
      .single();
    if (camp?.dsp_source === 'adform') metricField = 'tracked_ads';
    else metricField = 'impressions';
  }

  const { data, error } = await supabase.rpc('get_digital_geography_map_v2', {
    p_campaign_id: campaignId,
    p_scale: scale,
    p_pop_field: popField,
    p_media: media ?? undefined,
    p_bbox_xmin: xmin,
    p_bbox_ymin: ymin,
    p_bbox_xmax: xmax,
    p_bbox_ymax: ymax,
    p_metric_field: metricField,
  });

  if (error) {
    console.error('[digital/map]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // RPC returns JSON — Supabase JS may return string or parsed object
  let rows: Array<{
    code: string;
    nom: string;
    total_impressions: number;
    pop_value?: number | null;
    ratio?: number | null;
    geometry: GeoJSON.Geometry;
  }>;

  if (typeof data === 'string') {
    try { rows = JSON.parse(data); } catch { rows = []; }
  } else if (Array.isArray(data)) {
    rows = data;
  } else {
    rows = [];
  }

  logger.debug('digital/map', `campaign=${campaignId} scale=${scale} pop=${popField} features=${rows.length}`);

  const fc: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: rows.map(r => ({
      type: 'Feature',
      properties: {
        code: r.code,
        nom: r.nom,
        impressions: r.total_impressions,
        pop_value: r.pop_value,
        ratio: r.ratio,
      },
      geometry: r.geometry,
    })),
  };

  return NextResponse.json(fc, {
    headers: { 'Cache-Control': 'private, max-age=30' },
  });
}
