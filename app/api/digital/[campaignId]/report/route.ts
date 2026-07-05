/**
 * GET /api/digital/[campaignId]/report
 * Bilan de campagne générique (courbe conformité, avant/après, budget, KPI).
 * Réutilise buildCampaignReport (brique C). requireAuth + scope org explicite.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { buildCampaignReport } from '@/lib/report/aggregate';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { campaignId } = await params;

  const supabase = createAdminClient();
  const { data: camp } = await supabase
    .from('dsp_campaigns')
    .select('organization_id, dsp_source')
    .eq('id', campaignId)
    .single();

  // 404 si absente OU hors org (ne pas divulguer l'existence à une autre org)
  if (!camp) return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });
  if (profile.role !== 'super_admin' && camp.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });
  }

  const metric = camp.dsp_source === 'adform' ? 'tracked_ads' : 'impressions';
  try {
    const report = await buildCampaignReport(supabase, campaignId, metric);
    return NextResponse.json({ report: report ?? null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'report_failed' },
      { status: 400 },
    );
  }
}
