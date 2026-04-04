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

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const systeme = p.get('systeme') || undefined;
  const radioId = p.get('radio_id') || undefined;
  const radioIdsStr = p.get('radio_ids') || undefined;
  const excludeCatsStr = p.get('exclude_categories') || undefined;
  const bbox = p.get('bbox') || undefined;

  const radioIds = radioIdsStr ? radioIdsStr.split(',').filter(Boolean) : undefined;
  const excludeCats = excludeCatsStr ? excludeCatsStr.split(',').filter(Boolean) : undefined;

  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('get_radio_emetteurs_geojson', {
    p_bbox: bbox ?? null,
    p_systeme: systeme ?? null,
    p_radio_id: radioId ?? null,
    p_limit: 10000,
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
