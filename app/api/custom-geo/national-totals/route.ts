/**
 * GET /api/custom-geo/national-totals
 *
 * Totaux de population France par tranche d'âge (RPC
 * get_national_population_totals sur carreaux_5km, ~1 s à froid).
 * Cache mémoire serveur 24h : la donnée ne bouge qu'au ré-import des
 * carreaux — 1 seq scan par jour max, budget Nano préservé.
 *
 * Consommé par le plan média zones custom (colonne « % vs population France »).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let cached: { data: Record<string, number>; expires: number } | null = null;

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const now = Date.now();
  if (cached && now < cached.expires) {
    return NextResponse.json(
      { totals: cached.data, cached: true },
      { headers: { 'Cache-Control': 'private, max-age=86400' } },
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('get_national_population_totals') as {
    data: Record<string, number> | null;
    error: { message: string } | null;
  };
  if (error || !data) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  cached = { data, expires: now + CACHE_TTL_MS };
  return NextResponse.json(
    { totals: data, cached: false },
    { headers: { 'Cache-Control': 'private, max-age=86400' } },
  );
}
