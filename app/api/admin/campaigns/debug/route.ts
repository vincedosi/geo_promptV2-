/**
 * DEBUG — GET /api/admin/campaigns/debug
 * Bypasses auth to test if campaigns exist in DB
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('dsp_campaigns')
      .select('id, name, created_at')
      .order('created_at', { ascending: false });

    return NextResponse.json({
      ok: true,
      count: data?.length ?? 0,
      campaigns: data,
      error: error?.message ?? null,
      env_url: process.env.NEXT_PUBLIC_SUPABASE_URL?.substring(0, 30),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) });
  }
}
