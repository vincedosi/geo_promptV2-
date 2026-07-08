/**
 * GET /api/bidding/strategies/[id]/drift-events
 * Renvoie les événements de drift de cette stratégie.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkStrategyAccess } from '@/lib/campaigns/access';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { id } = await params;
  const supabase = createAdminClient();

  const access = await checkStrategyAccess(supabase, profile, id);
  if (access !== 'ok') return NextResponse.json({ error: 'strategy_not_found' }, { status: 404 });

  const { data, error } = await supabase
    .from('bidding_drift_events')
    .select(
      'id,strategy_id,postal_code,country_code,detected_at,drift_type,severity,metric_before,metric_after,delta,threshold,description,auto_action,resolved_at',
    )
    .eq('strategy_id', id)
    .order('detected_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ events: data ?? [] });
}
