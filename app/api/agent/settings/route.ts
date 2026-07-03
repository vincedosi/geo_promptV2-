/**
 * GET  /api/agent/settings — current user_default
 * PATCH /api/agent/settings — body: { autonomy_level: 0..4, config? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('agent_autonomy_settings')
    .select('id, autonomy_level, config, created_at, updated_at')
    .eq('scope_type', 'user_default')
    .eq('user_id', profile.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    settings: data ?? { autonomy_level: 2, config: {} }, // default Suggester
  });
}

export async function PATCH(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  let body: { autonomy_level?: number; config?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 });
  }
  const lvl = body.autonomy_level;
  if (typeof lvl !== 'number' || lvl < 0 || lvl > 4 || !Number.isInteger(lvl)) {
    return NextResponse.json({ error: 'autonomy_level doit être un entier 0..4' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('agent_autonomy_settings')
    .upsert(
      {
        scope_type: 'user_default',
        user_id: profile.id,
        strategy_id: null,
        autonomy_level: lvl,
        config: body.config ?? {},
      },
      { onConflict: 'user_id,strategy_id,scope_type' },
    )
    .select('id, autonomy_level, config, updated_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: data });
}
