/**
 * GET /api/radio/stats
 * KPIs radio via RPC get_radio_stats(). Accessible à tous les authentifiés.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  // service_role needed because RLS is SELECT-only for authenticated,
  // but this route is behind middleware getSession() check
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('get_radio_stats');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
