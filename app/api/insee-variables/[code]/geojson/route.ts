/**
 * GET /api/insee-variables/[code]/geojson?bbox=minLng,minLat,maxLng,maxLat
 *
 * Retourne un FeatureCollection des polygones CP dans le bbox, enrichi avec
 * la valeur de la variable INSEE demandée (property `value`). Utilisé par le
 * layer carto "Indicateurs civiques" dans Données terrain.
 *
 * Sortie : GeoJSON FeatureCollection { features: [{ geometry, properties: {code_postal, value, inscrits, code_dept} }] }
 *
 * Cache 1h (data publique stable). Gzip côté Next.js.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const SUPPORTED = new Set(['abstention_pres_2022']);
const FRANCE_BBOX = [-5.5, 41.0, 10.0, 51.5] as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { code } = await params;
  if (!SUPPORTED.has(code)) {
    return NextResponse.json({ error: 'unknown_variable', code }, { status: 404 });
  }

  const url = new URL(request.url);
  const bboxStr = url.searchParams.get('bbox');
  let bbox: [number, number, number, number];
  if (bboxStr) {
    const parts = bboxStr.split(',').map(Number);
    if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) {
      return NextResponse.json({ error: 'invalid_bbox' }, { status: 400 });
    }
    bbox = parts as [number, number, number, number];
  } else {
    bbox = [...FRANCE_BBOX] as [number, number, number, number];
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('get_civic_layer_geojson', {
    p_min_lng: bbox[0], p_min_lat: bbox[1],
    p_max_lng: bbox[2], p_max_lat: bbox[3],
  });

  if (error) {
    console.error('[civic-layer geojson]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? { type: 'FeatureCollection', features: [] }, {
    headers: { 'Cache-Control': 'no-store, must-revalidate' },
  });
}
