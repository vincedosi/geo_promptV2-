/**
 * GENESIS — GET /api/admin/campaigns
 * List all DSP campaigns with aggregated stats via SQL.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const supabase = createAdminClient();

  // Fetch campaigns
  const { data: campaigns, error } = await supabase
    .from('dsp_campaigns')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[GET /api/admin/campaigns] DB error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!campaigns || campaigns.length === 0) {
    return NextResponse.json([], { headers: { 'Cache-Control': 'no-store' } });
  }

  // Single aggregation query — lightweight COUNT/SUM grouped by campaign
  const { data: stats } = await supabase.rpc('get_dsp_campaign_stats');

  const statsMap = new Map<string, { total_rows: number; france_rows: number; matched_iris: number }>();
  for (const row of stats ?? []) {
    statsMap.set(row.campaign_id, {
      total_rows: row.total_rows ?? 0,
      france_rows: row.france_rows ?? 0,
      matched_iris: row.matched_iris ?? 0,
    });
  }

  const items = campaigns.map((c) => ({
    ...c,
    total_rows: statsMap.get(c.id)?.total_rows ?? 0,
    france_rows: statsMap.get(c.id)?.france_rows ?? 0,
    matched_iris: statsMap.get(c.id)?.matched_iris ?? 0,
  }));

  return NextResponse.json(items, { headers: { 'Cache-Control': 'no-store' } });
}
