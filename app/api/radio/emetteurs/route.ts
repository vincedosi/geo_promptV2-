/**
 * GET /api/radio/emetteurs
 * GeoJSON des émetteurs radio via RPC PostGIS (ST_AsGeoJSON + JOIN radios).
 * Query params: systeme, radio_id, bbox (west,south,east,north)
 * Limite: 10 000 résultats max.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const systeme = p.get('systeme') || undefined;
  const radioId = p.get('radio_id') || undefined;
  const bbox = p.get('bbox') || undefined;

  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('get_radio_emetteurs_geojson', {
    p_bbox: bbox ?? null,
    p_systeme: systeme ?? null,
    p_radio_id: radioId ?? null,
    p_limit: 10000,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? { type: 'FeatureCollection', features: [] }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
