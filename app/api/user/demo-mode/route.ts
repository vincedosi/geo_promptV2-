/**
 * GET/POST /api/user/demo-mode — mode démo par utilisateur (case overlay MAGELIAN).
 * Réservé admin/super_admin (autoritatif serveur — jamais un simple flag client).
 * Consommé par la route Canaux (démo = campagne.is_demo OU profile.demo_mode).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function isAdmin(role: string) { return role === 'admin' || role === 'super_admin'; }

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const supabase = createAdminClient();
  const { data } = await supabase.from('profiles').select('demo_mode').eq('id', profile.id).maybeSingle();
  return NextResponse.json({
    demo_mode: !!(data as { demo_mode?: boolean } | null)?.demo_mode,
    can_toggle: isAdmin(profile.role),
  });
}

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  if (!isAdmin(profile.role)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const parsed = z.object({ on: z.boolean() }).safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const supabase = createAdminClient();
  const { error } = await supabase.from('profiles').update({ demo_mode: parsed.data.on }).eq('id', profile.id);
  if (error) {
    console.error('[user/demo-mode] update:', error.message);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }
  return NextResponse.json({ demo_mode: parsed.data.on });
}
