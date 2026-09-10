/**
 * POST /api/agent/apply-recommendation
 *
 * Body : { audit_id: string, action_index: number, decision: 'approve' | 'reject' }
 * Applique (ou rejette) une recommandation suggérée par l'agent et trace
 * le résultat dans bidding_agent_actions.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { applyAction } from '@/lib/agent/autonomy';
import type { ProposedAction } from '@/lib/agent/types';
import { rpcJson } from '@/lib/supabase/rpc-json';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  let body: { audit_id?: string; action_index?: number; decision?: 'approve' | 'reject' };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 });
  }

  const { audit_id, action_index, decision } = body;
  if (!audit_id || typeof action_index !== 'number' || !decision) {
    return NextResponse.json(
      { error: 'Champs requis : audit_id, action_index, decision' },
      { status: 400 },
    );
  }
  if (decision !== 'approve' && decision !== 'reject') {
    return NextResponse.json({ error: `decision doit être 'approve' ou 'reject'` }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: audit, error: aErr } = await supabase
    .from('bidding_agent_actions')
    .select('id, user_id, strategy_id, recommendations, action_taken')
    .eq('id', audit_id)
    .single();
  if (aErr || !audit) {
    return NextResponse.json({ error: 'audit row introuvable' }, { status: 404 });
  }
  if (audit.user_id !== profile.id && profile.role !== 'admin' && profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const recs = rpcJson<ProposedAction[]>(audit.recommendations) ?? [];
  const action = recs[action_index];
  if (!action) {
    return NextResponse.json({ error: 'action_index hors plage' }, { status: 400 });
  }

  if (decision === 'reject') {
    await supabase
      .from('bidding_agent_actions')
      .update({ action_taken: 'human_rejected' })
      .eq('id', audit_id);
    return NextResponse.json({ status: 'human_rejected' });
  }

  // approve → applique l'action
  const applied = await applyAction(action, {
    user_id: profile.id,
    strategy_id: audit.strategy_id ?? undefined,
  });
  if (!applied) {
    return NextResponse.json({ error: `Action ${action.type} non appliquée (params invalides ou type non supporté)` }, { status: 400 });
  }
  await supabase
    .from('bidding_agent_actions')
    .update({
      action_taken: 'human_approved',
      applied_at: new Date().toISOString(),
    })
    .eq('id', audit_id);

  return NextResponse.json({ status: 'human_approved', applied_action: applied });
}
