/**
 * GENESIS — GET /api/admin/campaigns
 * List all DSP campaigns with aggregated stats via SQL.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/** Admin client with fetch cache disabled (Next.js caches fetch by default) */
function createNoCacheAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        fetch: (url, init) => fetch(url, { ...init, cache: 'no-store' }),
      },
    }
  );
}

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const supabase = createNoCacheAdminClient();

  const { data: campaigns, error } = await supabase
    .from('dsp_campaigns')
    .select('*, organizations(name)')
    .order('created_at', { ascending: false });

  console.log('[campaigns] found:', campaigns?.length);

  if (error) {
    console.error('[GET /api/admin/campaigns] DB error:', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
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

  // Linked organizations via pivot
  const campaignIds = campaigns.map((c) => c.id);
  const { data: links } = await supabase
    .from('campaign_organizations')
    .select('campaign_id, organization_id, organizations(id, name, slug)')
    .in('campaign_id', campaignIds);

  const linksMap = new Map<string, { id: string; name: string; slug: string }[]>();
  for (const l of links ?? []) {
    const o = (l as unknown as { organizations: { id: string; name: string; slug: string } }).organizations;
    if (!o) continue;
    const arr = linksMap.get(l.campaign_id) ?? [];
    arr.push(o);
    linksMap.set(l.campaign_id, arr);
  }

  const items = campaigns.map((c) => ({
    ...c,
    organization_name: (c as Record<string, unknown>).organizations ? ((c as Record<string, unknown>).organizations as Record<string, unknown>)?.name : null,
    organizations_linked: linksMap.get(c.id) ?? [],
    total_rows: statsMap.get(c.id)?.total_rows ?? 0,
    france_rows: statsMap.get(c.id)?.france_rows ?? 0,
    matched_iris: statsMap.get(c.id)?.matched_iris ?? 0,
  }));

  return NextResponse.json(items, { headers: { 'Cache-Control': 'no-store' } });
}
