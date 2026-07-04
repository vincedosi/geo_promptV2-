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
  const version = versionParam !== null ? parseInt(versionParam, 10) : null;
  if (versionParam !== null && Number.isNaN(version)) {
    return NextResponse.json({ error: 'invalid_version' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Version explicitement demandée : vérifier son existence AVANT d'appeler la RPC
  // (la RPC ne renvoie NULL que si la campagne n'a AUCUN snapshot, pas si la version demandée est absente)
  if (version !== null) {
    const { data: exists } = await supabase
      .from('campaign_plan_snapshot')
      .select('version')
      .eq('campaign_id', campaignId)
      .eq('version', version)
      .limit(1);
    if (!exists || exists.length === 0) {
      return NextResponse.json({ error: 'version_not_found' }, { status: 404 });
    }
  }

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
