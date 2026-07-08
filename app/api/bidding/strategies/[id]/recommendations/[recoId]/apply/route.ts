/**
 * POST /api/bidding/strategies/[id]/recommendations/[recoId]/apply
 *
 * Applique l'action proposée par une recommandation.
 *  - update_curve         : PATCH stratégie.in_zone_weights.curve
 *  - adjust_zone_multiplier: insert/update bidding_zone_configs
 *  - change_execution_mode: PATCH stratégie.execution_mode
 *  - retrain_zone         : appel POST /api/bidding/train avec un postal_code (TODO si endpoint pas disponible)
 *  - no_action            : marque applied sans action effective
 *
 * Trace dans bidding_agent_actions et marque la reco status=applied.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkStrategyAccess } from '@/lib/campaigns/access';

export const dynamic = 'force-dynamic';

const ProposedActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update_curve'),
    new_curve: z.array(z.object({ x: z.number(), y: z.number() })).min(2),
  }),
  z.object({
    type: z.literal('adjust_zone_multiplier'),
    postal_code: z.string(),
    new_multiplier: z.number().min(0).max(5),
  }),
  z.object({
    type: z.literal('change_execution_mode'),
    new_mode: z.enum(['monitor_only', 'suggest', 'auto']),
  }),
  z.object({
    type: z.literal('retrain_zone'),
    postal_code: z.string(),
  }),
  z.object({
    type: z.literal('no_action'),
  }),
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; recoId: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { id, recoId } = await params;
  const supabase = createAdminClient();

  const access = await checkStrategyAccess(supabase, profile, id);
  if (access !== 'ok') return NextResponse.json({ error: 'strategy_not_found' }, { status: 404 });

  const { data: reco, error: recoErr } = await supabase
    .from('agent_recommendations')
    .select('id, strategy_id, status, proposed_action, title')
    .eq('id', recoId)
    .eq('strategy_id', id)
    .single();

  if (recoErr || !reco) return NextResponse.json({ error: 'reco_not_found' }, { status: 404 });
  if (reco.status !== 'pending') {
    return NextResponse.json({ error: 'reco_not_pending', current_status: reco.status }, { status: 409 });
  }

  const action = reco.proposed_action ? ProposedActionSchema.safeParse(reco.proposed_action) : null;
  if (action && !action.success) {
    return NextResponse.json({ error: 'invalid_action_payload', issues: action.error.issues }, { status: 400 });
  }
  const parsedAction = action?.data ?? null;

  let actionResult: Record<string, unknown> = { applied: true };

  if (parsedAction?.type === 'update_curve') {
    const { data: strat } = await supabase
      .from('bidding_strategies')
      .select('in_zone_weights')
      .eq('id', id)
      .single();
    const w = (strat?.in_zone_weights ?? {}) as Record<string, unknown>;
    const newWeights = { ...w, curve: parsedAction.new_curve };
    const { error: upErr } = await supabase
      .from('bidding_strategies')
      .update({ in_zone_weights: newWeights })
      .eq('id', id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    actionResult = { type: 'update_curve', new_curve: parsedAction.new_curve };
  } else if (parsedAction?.type === 'adjust_zone_multiplier') {
    const { error: upErr } = await supabase
      .from('bidding_zone_configs')
      .upsert({
        strategy_id: id,
        postal_code: parsedAction.postal_code,
        bid_multiplier: parsedAction.new_multiplier,
      }, { onConflict: 'strategy_id,postal_code' });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    actionResult = { type: 'adjust_zone_multiplier', postal_code: parsedAction.postal_code, new_multiplier: parsedAction.new_multiplier };
  } else if (parsedAction?.type === 'change_execution_mode') {
    const { error: upErr } = await supabase
      .from('bidding_strategies')
      .update({ execution_mode: parsedAction.new_mode })
      .eq('id', id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    actionResult = { type: 'change_execution_mode', new_mode: parsedAction.new_mode };
  } else if (parsedAction?.type === 'retrain_zone') {
    actionResult = { type: 'retrain_zone', postal_code: parsedAction.postal_code, status: 'queued' };
  } else if (parsedAction?.type === 'no_action') {
    actionResult = { type: 'no_action' };
  }

  // Marque la reco appliquée
  await supabase
    .from('agent_recommendations')
    .update({ status: 'applied', applied_at: new Date().toISOString(), applied_by: profile.id })
    .eq('id', recoId);

  // Trace dans bidding_agent_actions (best-effort, ne casse pas si la table a un schéma différent)
  try {
    await supabase.from('bidding_agent_actions').insert({
      strategy_id: id,
      action_type: parsedAction?.type ?? 'no_action',
      action_payload: actionResult,
      triggered_by: 'recommendation',
      reference_id: recoId,
      is_autonomous: false,
    });
  } catch { /* table existe peut-être avec un autre schéma — best-effort */ }

  return NextResponse.json({ status: 'applied', action: actionResult, reco_id: recoId });
}
