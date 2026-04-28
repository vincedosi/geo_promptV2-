/**
 * GET /api/digital/[campaignId]/analysis
 * ?type=breakdown|medias|indicators
 * &aggregation=region|dept|cp
 * &indicator=population
 * &media=Antvoice,Web366
 * &limit=100
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { campaignId } = await params;
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'breakdown';

  const supabase = createAdminClient();

  if (type === 'medias') {
    const { data, error } = await supabase.rpc('get_campaign_medias', { p_campaign_id: campaignId });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = typeof data === 'string' ? JSON.parse(data) : (data ?? []);
    return NextResponse.json(rows);
  }

  if (type === 'heatmap') {
    const aggregation = searchParams.get('aggregation') || 'region';
    const indicator = searchParams.get('indicator') || 'population';
    const metricRaw = (searchParams.get('metric') ?? '').trim();
    let metricField = metricRaw || 'tracked_ads';
    if (metricRaw === 'unique') metricField = 'unique_impressions';
    else if (metricRaw === 'impressions' || metricRaw === '') {
      const { data: camp } = await supabase.from('dsp_campaigns').select('dsp_source').eq('id', campaignId).single();
      metricField = camp?.dsp_source === 'adform' ? 'tracked_ads' : 'impressions';
    }
    const { data, error } = await supabase.rpc('get_digital_media_heatmap_v2', {
      p_campaign_id: campaignId,
      p_aggregation: aggregation,
      p_indicator: indicator,
      p_metric_field: metricField,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const result = typeof data === 'string' ? JSON.parse(data) : (data ?? {});
    return NextResponse.json(result);
  }

  if (type === 'indicators') {
    const { data, error } = await supabase.rpc('get_digital_available_indicators');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = typeof data === 'string' ? JSON.parse(data) : (data ?? []);
    return NextResponse.json(rows);
  }

  // breakdown
  const aggregation = searchParams.get('aggregation') || 'region';
  const indicator = searchParams.get('indicator') || 'population';
  const mediaStr = searchParams.get('media');
  const media = mediaStr ? mediaStr.split(',').filter(Boolean) : null;
  const limit = parseInt(searchParams.get('limit') || '100', 10);
  const popMin = parseFloat(searchParams.get('pop_min') || '0') || 0;
  const metricRaw = (searchParams.get('metric') ?? '').trim();
  let metricField = metricRaw || 'tracked_ads';
  if (metricRaw === 'unique') metricField = 'unique_impressions';
  else if (metricRaw === 'impressions' || metricRaw === '') {
    const { data: camp } = await supabase.from('dsp_campaigns').select('dsp_source').eq('id', campaignId).single();
    metricField = camp?.dsp_source === 'adform' ? 'tracked_ads' : 'impressions';
  }

  // Drill-down parent filter : restrict to depts of a region, or CPs of a dept
  const parentTypeRaw = searchParams.get('parent_type');
  const parentType = parentTypeRaw === 'region' || parentTypeRaw === 'dept' ? parentTypeRaw : null;
  const parentCode = parentType ? searchParams.get('parent_code') : null;

  const { data, error } = await supabase.rpc('get_digital_analysis_breakdown_v2', {
    p_campaign_id: campaignId,
    p_aggregation: aggregation,
    p_indicator: indicator,
    p_media: media,
    p_limit: limit,
    p_pop_min: popMin,
    p_metric_field: metricField,
    p_parent_type: parentType,
    p_parent_code: parentCode,
  });

  if (error) {
    console.error('[digital/analysis]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = typeof data === 'string' ? JSON.parse(data) : (data ?? []);
  console.log(`[digital/analysis] type=breakdown agg=${aggregation} indicator=${indicator} rows=${rows.length} first_nom=${rows[0]?.nom ?? 'N/A'}`);
  return NextResponse.json(rows, { headers: { 'Cache-Control': 'no-store' } });
}
