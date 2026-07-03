/**
 * GET /api/custom-geo/[id]/items-audience
 *
 * Audience par item d'une zone custom (les 4 CIRFA d'une zone battle, etc.).
 * Lit le cache custom_geo_zones.items_audience_stats ; s'il est absent,
 * déclenche compute_zone_items_audience (croisement carreaux 200m, gardé
 * par les caps 20 items / 5000 km²) puis renvoie le résultat.
 *
 * Réponse : { items: [{poi_id, poi_name, area_km2, population}] }
 *           { items: null }  → zone non décomposable (pas de battle_features),
 *                              l'appelant retombe sur audience_stats global.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface ItemsStats {
  computed_at?: string;
  skipped?: boolean;
  reason?: string;
  items?: Array<Record<string, unknown>> | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const supabase = createAdminClient();

  // 1. Cache (calculé une fois par zone — invalidé seulement par recalcul)
  const { data: zone, error } = await supabase
    .from('custom_geo_zones')
    .select('id, items_audience_stats')
    .eq('id', params.id)
    .single();
  if (error || !zone) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const cached = zone.items_audience_stats as ItemsStats | null;
  if (cached?.items?.length || cached?.skipped) {
    return NextResponse.json({ items: cached.items ?? null, skipped: cached.skipped ?? false });
  }

  // 2. Calcul (RPC SECURITY DEFINER — le contrôle d'accès org est dedans)
  const { data: computed, error: rpcError } = await supabase.rpc('compute_zone_items_audience', {
    p_zone_id: params.id,
    p_caller_user_id: profile.id,
  }) as { data: ItemsStats | null; error: { message: string } | null };
  if (rpcError) {
    console.error('[items-audience]', rpcError.message);
    return NextResponse.json({ error: 'compute_failed' }, { status: 500 });
  }
  return NextResponse.json({
    items: computed?.items ?? null,
    skipped: computed?.skipped ?? false,
  });
}
