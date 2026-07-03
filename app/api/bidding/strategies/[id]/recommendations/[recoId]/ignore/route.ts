/**
 * POST /api/bidding/strategies/[id]/recommendations/[recoId]/ignore
 * Marque une reco comme ignored (sans action sur la stratégie).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; recoId: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { id, recoId } = await params;
  const supabase = createAdminClient();

  const { error } = await supabase
    .from('agent_recommendations')
    .update({ status: 'ignored', applied_at: new Date().toISOString(), applied_by: profile.id })
    .eq('id', recoId)
    .eq('strategy_id', id)
    .eq('status', 'pending');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ status: 'ignored', reco_id: recoId });
}
