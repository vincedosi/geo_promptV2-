/**
 * GET /api/digital/[campaignId]/pacing?version=<int>
 * Diagnostic plan-vs-réel par item (parts intra-zone, écart, statut) + spillover.
 * Métrique du réel = tracked_ads pour Adform, sinon impressions (réconciliation panneau).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { computePacing, type PacingItemInput } from '@/lib/pacing/compute';

export const dynamic = 'force-dynamic';

interface PacingRpc {
  version: number;
  items: PacingItemInput[];
  in_plan_imp: number;
  total_imp: number;
  spillover: { imp: number; spend: number };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { campaignId } = await params;
  const { searchParams } = new URL(request.url);
  const versionParam = searchParams.get('version');
  const version = versionParam ? parseInt(versionParam, 10) : null;

  const supabase = createAdminClient();

  // Métrique alignée sur le panneau d'analyse
  const { data: camp } = await supabase
    .from('dsp_campaigns').select('dsp_source').eq('id', campaignId).single();
  const metricField = camp?.dsp_source === 'adform' ? 'tracked_ads' : 'impressions';

  const { data, error } = await supabase.rpc('get_campaign_pacing', {
    p_campaign_id: campaignId,
    p_metric_field: metricField,
    p_version: version,
  });
  if (error) {
    console.error('[digital/pacing]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rpc = (typeof data === 'string' ? JSON.parse(data) : data) as PacingRpc | null;
  if (!rpc) {
    return NextResponse.json({ empty: true }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const items = computePacing(rpc.items ?? []);
  return NextResponse.json(
    { version: rpc.version, items, in_plan_imp: rpc.in_plan_imp, total_imp: rpc.total_imp, spillover: rpc.spillover },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
