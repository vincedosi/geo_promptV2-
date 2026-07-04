import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { computeRebidWeights, type RebidItemInput } from '@/lib/pacing/rebid';
import { computePacing, type PacingItemInput } from '@/lib/pacing/compute';
import { assertDemo, latestVersion, createPeriodSnapshot, simulateCurrentPeriod } from '@/lib/demo/controller';
import { DEMO_CAMPAIGN_ID } from '@/lib/demo/constants';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  const supabase = createAdminClient();
  try {
    await assertDemo(supabase, DEMO_CAMPAIGN_ID);
    const version = await latestVersion(supabase);
    if (version === 0) return NextResponse.json({ error: 'no_snapshot' }, { status: 400 });

    // Diagnostic de la version courante via la vraie RPC
    const { data } = await supabase.rpc('get_campaign_pacing', {
      p_campaign_id: DEMO_CAMPAIGN_ID, p_metric_field: 'impressions', p_version: version,
    });
    const rpc = (typeof data === 'string' ? JSON.parse(data) : data) as { items: PacingItemInput[] } | null;
    if (!rpc?.items?.length) return NextResponse.json({ error: 'no_pacing' }, { status: 400 });

    const pacing = computePacing(rpc.items);
    const rebid = computeRebidWeights(pacing.map<RebidItemInput>(p => ({
      zone_id: p.zone_id, item_id: p.item_id, item_weight: p.item_weight,
      expected_share: p.expected_share, actual_share: p.actual_share,
    })));

    // Cible FIXE (reportée depuis le pacing = expected_share du snapshot, invariant) ;
    // enchère = nouvelle sortie du rebid.
    const items = rebid.map(r => {
      const src = pacing.find(p => p.item_id === r.item_id)!;
      return {
        item_id: r.item_id, item_name: src.item_name,
        target_share: src.expected_share,               // CIBLE FIXE
        bid_weight: Math.round(r.new_weight * 10) / 10,  // nouvelle ENCHÈRE
      };
    });
    const newVersion = await createPeriodSnapshot(supabase, profile.id, items, version + 1);
    const { rows } = await simulateCurrentPeriod(supabase);
    return NextResponse.json({ ok: true, version: newVersion, delivery_rows: rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'rebid_failed' }, { status: 400 });
  }
}
