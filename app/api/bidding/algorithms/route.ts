/**
 * GET /api/bidding/algorithms — liste des algos enabled, ordonnés par display_order.
 * Alimente le dropdown "Algorithme" du modal Activer Custom Bidding.
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
    .from('bidding_algorithms')
    .select('code, display_name, family, library, is_baseline, display_order')
    .eq('is_enabled', true)
    .order('display_order', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ algorithms: data ?? [] });
}
