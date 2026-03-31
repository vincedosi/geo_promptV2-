import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('get_sources_stats');
  if (error) {
    console.error('[sources-stats] RPC error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, ...data });
}
