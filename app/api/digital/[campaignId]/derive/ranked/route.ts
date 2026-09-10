/**
 * GET /api/digital/[campaignId]/derive/ranked?mesh=&metric=&actors=&limit=
 * — zones qui dérivent à la maille, pire d'abord (RPC get_campaign_derive_ranked).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import { parseActorsParam } from '@/lib/campaigns/derive-metrics';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ campaignId: string }> }) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { campaignId } = await params;

  const sp = request.nextUrl.searchParams;
  const mesh = (['region', 'departement', 'cp'].includes(sp.get('mesh') ?? '') ? sp.get('mesh') : 'departement') as string;
  const metric = (sp.get('metric') === 'objectif' ? 'objectif' : 'hold');
  const limit = Math.min(200, Math.max(1, Number(sp.get('limit')) || 50));
  const pActors = parseActorsParam(sp);

  const supabase = createAdminClient();
  const access = await checkCampaignAccess(supabase, profile, campaignId);
  if (access !== 'ok') return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });

  const { data, error } = await supabase.rpc('get_campaign_derive_ranked', {
    p_campaign_id: campaignId, p_mesh: mesh, p_metric: metric, p_actors: pActors ?? undefined, p_limit: limit,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
}
