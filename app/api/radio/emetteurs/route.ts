/**
 * GET /api/radio/emetteurs
 * GeoJSON des emetteurs radio via RPC PostGIS.
 * Query params:
 *   systeme — 'FM' | 'DAB+'
 *   radio_id — single UUID filter
 *   radio_ids — comma-separated UUIDs (multi-filter)
 *   exclude_categories — comma-separated categories to exclude (e.g. 'D,E,P')
 *   bbox — west,south,east,north
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const profile = await requireAuth(req);
  if (!profile) return authUnauthorized();
  const p = req.nextUrl.searchParams;
  const systeme = p.get('systeme') || undefined;
  const radioId = p.get('radio_id') || undefined;
  const radioIdsStr = p.get('radio_ids') || undefined;
  const excludeCatsStr = p.get('exclude_categories') || undefined;
  const bbox = p.get('bbox') || undefined;

  const radioIds = radioIdsStr ? radioIdsStr.split(',').filter(Boolean) : undefined;
  const excludeCats = excludeCatsStr ? excludeCatsStr.split(',').filter(Boolean) : undefined;

  const supabase = createAdminClient();

  // Cap supérieur pour le mode "coverage" (fetch global sans bbox) :
  // 11 836 émetteurs en base + marge de croissance. Le RPC tronque déjà
  // côté DB si nécessaire — pas de risque I/O.
  const limitParam = Number(p.get('limit') ?? 15000);
  const safeLimit  = Math.min(Math.max(1, isNaN(limitParam) ? 15000 : limitParam), 20000);

  const { data, error } = await supabase.rpc('get_radio_emetteurs_geojson', {
    p_bbox: bbox ?? null,
    p_systeme: systeme ?? null,
    p_radio_id: radioId ?? null,
    p_limit: safeLimit,
    p_radio_ids: radioIds ?? null,
    p_exclude_categories: excludeCats ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? { type: 'FeatureCollection', features: [] }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
