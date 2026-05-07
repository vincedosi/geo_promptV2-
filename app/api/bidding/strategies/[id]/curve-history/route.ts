/**
 * GET /api/bidding/strategies/[id]/curve-history
 *
 * Renvoie tous les snapshots de la courbe de pondération INSEE de la stratégie,
 * ordonnés chronologiquement. Utilisé par CurveTranslator pour afficher
 * l'évolution jour-par-jour.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { id } = await params;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('bidding_curve_history')
    .select('id, applied_at, curve, delta_pct, triggered_by, reason, reference_id')
    .eq('strategy_id', id)
    .order('applied_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ snapshots: data ?? [] });
}
