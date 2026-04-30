/**
 * GET   /api/agent/settings/strategy/[id] — current override (or null)
 * PATCH /api/agent/settings/strategy/[id] — body: { autonomy_level?: 0..4 | null, config? }
 *   - autonomy_level=null → DELETE override (revient au user_default)
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
    .from('agent_autonomy_settings')
    .select('id, autonomy_level, config, updated_at')
    .eq('scope_type', 'strategy_override')
    .eq('strategy_id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ override: data ?? null });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { id } = await params;
  let body: { autonomy_level?: number | null; config?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 });
  }

  const supabase = createAdminClient();
  if (body.autonomy_level === null) {
    await supabase
      .from('agent_autonomy_settings')
      .delete()
      .eq('scope_type', 'strategy_override')
      .eq('strategy_id', id);
    return NextResponse.json({ override: null });
  }

  const lvl = body.autonomy_level;
  if (typeof lvl !== 'number' || lvl < 0 || lvl > 4 || !Number.isInteger(lvl)) {
    return NextResponse.json({ error: 'autonomy_level doit être un entier 0..4 ou null' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('agent_autonomy_settings')
    .upsert(
      {
        scope_type: 'strategy_override',
        user_id: profile.id,
        strategy_id: id,
        autonomy_level: lvl,
        config: body.config ?? {},
      },
      { onConflict: 'user_id,strategy_id,scope_type' },
    )
    .select('id, autonomy_level, config, updated_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ override: data });
}
