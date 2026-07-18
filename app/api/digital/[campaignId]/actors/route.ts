/**
 * GET /api/digital/[campaignId]/actors — liste des acteurs (DSP/social/régie)
 * de la campagne avec livré/dépense/CPM/part/atteinte objectif. Alimente le
 * multi-select et le panneau « Par acteur » du Suivi. Lit les rollups (RPC).
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

  const { data, error } = await supabase.rpc('get_campaign_actors', { p_campaign_id: campaignId });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? { objective_pct: null, actors: [] }, { headers: { 'Cache-Control': 'no-store' } });
}
