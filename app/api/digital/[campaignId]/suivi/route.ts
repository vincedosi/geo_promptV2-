/**
 * GET /api/digital/[campaignId]/suivi — payload complet du cockpit de suivi
 * (RPC get_campaign_suivi, lecture des rollups uniquement).
 *
 * Backfill lazy : si les rollups n'existent pas encore (campagne historique,
 * jamais réimportée depuis la 107), on les construit UNE fois puis on relit —
 * uniquement pour les campagnes avec stratégie (le cockpit n'a pas de sens
 * sans budget/plan, et ça évite de scanner les très grosses campagnes
 * d'import pur type démo nationale).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import { parseActorsParam } from '@/lib/campaigns/actor-metrics';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { campaignId } = await params;

  const pActors = parseActorsParam(request.nextUrl.searchParams);

  const supabase = createAdminClient();
  const access = await checkCampaignAccess(supabase, profile, campaignId);
  if (access !== 'ok') return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });

  let { data, error } = await supabase.rpc('get_campaign_suivi', { p_campaign_id: campaignId, p_actors: pActors });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (data?.error === 'no_strategy') {
    return NextResponse.json({ error: 'no_strategy' }, { status: 409 });
  }
  if (data?.error === 'no_rollup') {
    const { error: refreshErr } = await supabase.rpc('refresh_campaign_rollups', { p_campaign_id: campaignId });
    if (refreshErr) return NextResponse.json({ error: refreshErr.message }, { status: 500 });
    ({ data, error } = await supabase.rpc('get_campaign_suivi', { p_campaign_id: campaignId, p_actors: pActors }));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (data?.error) return NextResponse.json({ error: data.error }, { status: 409 });
  }

  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}
