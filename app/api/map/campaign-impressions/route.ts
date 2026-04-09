import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get('campaign_id');

  if (!campaignId) {
    return NextResponse.json({ error: 'campaign_id required' }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();

    // Fetch lightweight stats with percentiles (no GeoJSON)
    const { data: stats, error } = await supabase.rpc('get_dsp_impression_stats', {
      p_campaign_id: campaignId,
    });

    if (error) {
      console.error('[campaign-impressions] stats error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      stats: stats || {
        min: 0, max: 0, median: 0, p75: 0, p90: 0, p95: 0,
        total_impressions: 0, zones_count: 0,
      },
    }, {
      headers: { 'Cache-Control': 'public, max-age=120' },
    });
  } catch (err) {
    console.error('[campaign-impressions] unexpected:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
