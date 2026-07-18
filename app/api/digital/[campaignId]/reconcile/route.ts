/**
 * GET /api/digital/[campaignId]/reconcile — payload de réconciliation
 * DSP ⇔ ad server (RPC get_campaign_reconciliation, lecture des agrégats).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { checkCampaignAccess } from '@/lib/campaigns/access';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { campaignId } = await params;

  const supabase = createAdminClient();
  const access = await checkCampaignAccess(supabase, profile, campaignId);
  if (access !== 'ok') return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });

  const { data, error } = await supabase.rpc('get_campaign_reconciliation', { p_campaign_id: campaignId });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}
