/**
 * POST /api/agent/apply-recommendation
 *
 * Body : { audit_id: string, action_index: number, decision: 'approve' | 'reject' }
 * Applique (ou rejette) une recommandation suggérée par l'agent et trace
 * le résultat dans bidding_agent_actions.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { lireCorps } from '@/lib/api/valider-corps';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { applyAction } from '@/lib/agent/autonomy';
import type { ProposedAction } from '@/lib/agent/types';
import { rpcJson } from '@/lib/supabase/rpc-json';
import { checkStrategyAccess } from '@/lib/campaigns/access';

export const dynamic = 'force-dynamic';

/**
 * Les trois champs etaient verifies a la main, `action_index` par un
 * `typeof … === 'number'` qui laissait passer les flottants et les negatifs.
 * `audit_id` adresse `bidding_agent_actions.id`, une colonne `uuid` : une valeur
 * qui n'en est pas produisait un 404 « audit row introuvable » trompeur.
 */
const AppliquerRecommandationSchema = z.object({
  audit_id: z.string().uuid(),
  action_index: z.number().int().nonnegative(),
  decision: z.enum(['approve', 'reject']),
});

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const corps = await lireCorps(request, AppliquerRecommandationSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });
  const { audit_id, action_index, decision } = corps.valeur;

  const supabase = createAdminClient();
  const { data: audit, error: aErr } = await supabase
    .from('bidding_agent_actions')
    .select('id, user_id, strategy_id, recommendations, action_taken')
    .eq('id', audit_id)
    .single();
  if (aErr || !audit) {
    return NextResponse.json({ error: 'audit row introuvable' }, { status: 404 });
  }
  // L'auteur, le super_admin, ou un admin de l'organisation de la stratégie.
  // Jusqu'au 2026-10-08 le rôle `admin` suffisait, toutes organisations
  // confondues.
  if (audit.user_id !== profile.id && profile.role !== 'super_admin') {
    const autorise = profile.role === 'admin' && !!audit.strategy_id
      && (await checkStrategyAccess(supabase, profile, audit.strategy_id)) === 'ok';
    if (!autorise) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
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
