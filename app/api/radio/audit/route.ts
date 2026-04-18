/**
 * GET /api/radio/audit
 * Comprehensive radio matching audit data for the admin dashboard.
 * Returns KPIs, per-category breakdown, unmatched radios with diagnostics.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('get_radio_audit');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
