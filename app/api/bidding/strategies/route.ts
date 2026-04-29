/**
 * GET /api/bidding/strategies
 *
 * Liste les stratégies + métadonnées campagne pour la page liste /custom-bidding.
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
    .from('bidding_strategies')
    .select(`
      id, name, campaign_id, algorithm_code, objective_code,
      execution_mode, scope_type, status, start_date, end_date,
      is_demo, created_at,
      dsp_campaigns!inner ( id, name, dsp_source, is_demo, advertiser )
    `)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ strategies: data ?? [] });
}
