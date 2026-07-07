/**
 * GET /api/cibles/indicators — catalogue des indicateurs ciblables (registre).
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
    .from('cible_indicator_registry')
    .select('indicator_code, label, famille, unit, slider_min, slider_max, slider_step, default_operator, scale, dynamic')
    .eq('active', true)
    .order('famille')
    .order('label');
  if (error) {
    console.error('[cibles/indicators]', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  return NextResponse.json({ indicators: data ?? [] });
}
