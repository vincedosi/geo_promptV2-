/**
 * GET /api/digital/[campaignId]/suivi/cps?dept=75 — drill niveau 3 du
 * tableau de suivi : les CP d'un département (max 500, pires indices d'abord).
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

  const dept = request.nextUrl.searchParams.get('dept') ?? '';
  if (!/^\d{2,3}$/.test(dept)) {
    return NextResponse.json({ error: 'invalid_dept' }, { status: 400 });
  }

  // ?actors= vide/blanc ⇒ null (« tous »), jamais [] (que le RPC lit « aucun acteur »).
  const actorsRaw = request.nextUrl.searchParams.get('actors');
  const actorsList = actorsRaw ? actorsRaw.split(',').map((a) => a.trim()).filter(Boolean) : [];
  const pActors = actorsList.length ? actorsList : null;

  const supabase = createAdminClient();
  const access = await checkCampaignAccess(supabase, profile, campaignId);
  if (access !== 'ok') return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });

  const { data, error } = await supabase.rpc('get_campaign_suivi_cps', {
    p_campaign_id: campaignId, p_dept: dept, p_actors: pActors,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ cps: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
}
