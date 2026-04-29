/**
 * POST /api/bidding/proposals/[id]/approve
 *
 * Transfère la proposition vers bidding_zone_configs (UPSERT) et marque
 * la proposition comme `applied`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  if (profile.role !== 'admin' && profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'admin requis' }, { status: 403 });
  }

  const { id } = await params;
  const supabase = createAdminClient();

  // Charge la proposition
  const { data: prop, error: propErr } = await supabase
    .from('bidding_zone_config_proposals')
    .select('*')
    .eq('id', id)
    .single();

  if (propErr || !prop) {
    return NextResponse.json({ error: 'Proposition introuvable' }, { status: 404 });
  }
  if (prop.status !== 'pending' && prop.status !== 'approved') {
    return NextResponse.json(
      { error: `Proposition en status=${prop.status} (attendu: pending|approved)` },
      { status: 409 },
    );
  }

  // UPSERT bidding_zone_configs
  const cfgPayload: Record<string, unknown> = {
    strategy_id: prop.strategy_id,
    postal_code: prop.postal_code,
    country_code: prop.country_code ?? 'FR',
    bid_multiplier: prop.proposed_bid_multiplier,
    is_active: true,
  };
  if (prop.proposed_floor_bid !== null) cfgPayload.floor_bid = prop.proposed_floor_bid;
  if (prop.proposed_ceiling_bid !== null) cfgPayload.ceiling_bid = prop.proposed_ceiling_bid;
  if (prop.proposed_target_metrics && Object.keys(prop.proposed_target_metrics).length > 0) {
    cfgPayload.target_metrics = prop.proposed_target_metrics;
  }
  if (prop.proposed_constraints && Object.keys(prop.proposed_constraints).length > 0) {
    cfgPayload.constraints = prop.proposed_constraints;
  }

  const { data: cfg, error: cfgErr } = await supabase
    .from('bidding_zone_configs')
    .upsert(cfgPayload, { onConflict: 'strategy_id,postal_code,country_code' })
    .select('id')
    .single();

  if (cfgErr || !cfg) {
    return NextResponse.json(
      { error: `UPSERT bidding_zone_configs failed: ${cfgErr?.message ?? 'unknown'}` },
      { status: 500 },
    );
  }

  // Marque la proposition appliquée
  const { error: updErr } = await supabase
    .from('bidding_zone_config_proposals')
    .update({
      status: 'applied',
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
      applied_at: new Date().toISOString(),
      applied_to_config_id: cfg.id,
    })
    .eq('id', id);

  if (updErr) {
    return NextResponse.json(
      { error: `UPDATE proposal failed: ${updErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ proposal_id: id, config_id: cfg.id, status: 'applied' });
}
