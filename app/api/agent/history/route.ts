/**
 * GET /api/agent/history?limit=50
 * Renvoie les N dernières interactions agent (audit trail).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { searchParams } = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit') ?? '50')));
  const strategyId = searchParams.get('strategy_id');

  const supabase = createAdminClient();
  let q = supabase
    .from('bidding_agent_actions')
    .select(
      'id, user_id, strategy_id, drift_event_id, intent, trigger_source, user_message, agent_response, recommendations, action_taken, applied_at, llm_model, llm_tokens_input, llm_tokens_output, llm_duration_ms, autonomy_level_at_time, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (strategyId) q = q.eq('strategy_id', strategyId);
  if (profile.role !== 'admin' && profile.role !== 'super_admin') {
    q = q.eq('user_id', profile.id);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ actions: data ?? [] });
}
