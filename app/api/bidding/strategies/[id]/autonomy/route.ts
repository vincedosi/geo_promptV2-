/**
 * GET  /api/bidding/strategies/[id]/autonomy
 *   → Récupère les settings autonomy de la stratégie (ou défauts si absent).
 *
 * PUT  /api/bidding/strategies/[id]/autonomy
 *   → Upsert des bornes autonomie (settings du media planner).
 *     Body : { autonomy_enabled, autonomy_level, autonomy_max_curve_delta_pct,
 *              autonomy_max_budget_delta_pct, autonomy_max_actions_per_day }
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const PutSchema = z.object({
  autonomy_enabled: z.boolean().optional(),
  autonomy_level: z.number().int().min(0).max(4).optional(),
  autonomy_max_curve_delta_pct: z.number().min(0).max(100).optional(),
  autonomy_max_budget_delta_pct: z.number().min(0).max(100).optional(),
  autonomy_max_actions_per_day: z.number().int().min(0).max(50).optional(),
});

const DEFAULTS = {
  autonomy_enabled: false,
  autonomy_level: 2,
  autonomy_max_curve_delta_pct: 20,
  autonomy_max_budget_delta_pct: 30,
  autonomy_max_actions_per_day: 5,
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { id } = await params;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('agent_autonomy_settings')
    .select('autonomy_enabled, autonomy_level, autonomy_max_curve_delta_pct, autonomy_max_budget_delta_pct, autonomy_max_actions_per_day')
    .eq('scope_type', 'strategy')
    .eq('strategy_id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? DEFAULTS);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { id } = await params;

  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const parsed = PutSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });

  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from('agent_autonomy_settings')
    .select('id')
    .eq('scope_type', 'strategy')
    .eq('strategy_id', id)
    .maybeSingle();

  const payload = { ...parsed.data, updated_at: new Date().toISOString() };

  if (existing?.id) {
    const { error } = await supabase
      .from('agent_autonomy_settings')
      .update(payload)
      .eq('id', existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabase
      .from('agent_autonomy_settings')
      .insert({
        scope_type: 'strategy',
        strategy_id: id,
        ...DEFAULTS,
        ...parsed.data,
      });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ status: 'updated' });
}
