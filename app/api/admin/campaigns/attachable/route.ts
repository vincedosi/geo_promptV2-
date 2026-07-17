/**
 * GET /api/admin/campaigns/attachable?exclude=<campaignId>
 * Campagnes importées de l'org rattachables à une campagne du wizard :
 * elles ont des données mais aucune stratégie de bidding.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  const exclude = request.nextUrl.searchParams.get('exclude');

  const supabase = createAdminClient();
  const { data: exCamp } = exclude
    ? await supabase.from('dsp_campaigns').select('organization_id').eq('id', exclude).maybeSingle()
    : { data: null };
  const orgId = exCamp?.organization_id ?? profile.organization_id;
  if (!orgId) return NextResponse.json({ campaigns: [] });
  if (profile.role !== 'super_admin' && orgId !== profile.organization_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [{ data: camps }, { data: strats }] = await Promise.all([
    supabase.from('dsp_campaigns')
      .select('id, name, dsp_source, date_start, date_end, total_tracked_ads')
      .eq('organization_id', orgId)
      .neq('id', exclude ?? '00000000-0000-0000-0000-000000000000')
      .gt('total_tracked_ads', 0)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from('bidding_strategies').select('campaign_id'),
  ]);
  const withStrategy = new Set((strats ?? []).map((s) => s.campaign_id));
  const campaigns = (camps ?? [])
    .filter((c) => !withStrategy.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, dsp_source: c.dsp_source, rows: c.total_tracked_ads, date_start: c.date_start, date_end: c.date_end }));
  return NextResponse.json({ campaigns });
}
