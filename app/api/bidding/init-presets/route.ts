/**
 * GET /api/bidding/init-presets
 *   → liste les 5 presets de pondération seedés (boost_light, focus, exclusive, neutral, custom).
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
    .from('bidding_init_presets')
    .select('code, display_name, display_name_fr, description, description_fr, in_zone_multiplier, out_zone_multiplier, is_default, display_order')
    .eq('is_enabled', true)
    .order('display_order', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ presets: data ?? [] });
}
