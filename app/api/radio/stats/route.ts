/**
 * GET /api/radio/stats
 * KPIs radio via RPC get_radio_stats(). Accessible à tous les authentifiés.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const _profile = await requireAuth(req);
  if (!_profile) return authUnauthorized();

  // service_role needed because RLS is SELECT-only for authenticated,
  // but this route is behind middleware getSession() check
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('get_radio_stats');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
