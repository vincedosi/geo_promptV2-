/**
 * GET /api/digital/[campaignId]/report
 * Bilan de campagne générique (courbe conformité, avant/après, budget, KPI).
 * Réutilise buildCampaignReport (brique C). requireAuth + scope org explicite.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { checkCampaignAccess } from '@/lib/campaigns/access';
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

  // Scope org via le helper commun (owner OU org liée via campaign_organizations),
  // 404 uniforme — l'ancien check inline refusait à tort les orgs liées.
  const access = await checkCampaignAccess(supabase, profile, campaignId);
  if (access !== 'ok') return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });

  const { data: camp, error: campErr } = await supabase
    .from('dsp_campaigns')
    .select('dsp_source')
    .eq('id', campaignId)
    .single();

  if (campErr || !camp) {
    if (campErr) console.error('[digital/report] campagne:', campErr.message);
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 });
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
