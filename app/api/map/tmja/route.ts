import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Tolerance de simplification géométrique selon le zoom (degrés WGS84)
function zoomToTolerance(zoom: number): number {
  if (zoom >= 12) return 0.0001; // Fix B : was 0, halve payload (-54%) sans perte visuelle
  if (zoom >= 11) return 0.001;
  if (zoom >= 10) return 0.002;
  if (zoom >= 9)  return 0.005;
  return 0.01; // zoom 8 et moins
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const west  = parseFloat(p.get('west')  ?? '-5.2');
  const south = parseFloat(p.get('south') ?? '41.0');
  const east  = parseFloat(p.get('east')  ?? '9.7');
  const north = parseFloat(p.get('north') ?? '51.5');
  const zoom  = parseFloat(p.get('zoom')  ?? '10');

  if ([west, south, east, north].some(isNaN)) {
    return NextResponse.json({ error: 'Paramètres bbox invalides' }, { status: 400 });
  }

  const tolerance = zoomToTolerance(isNaN(zoom) ? 10 : zoom);

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('get_tmja_by_bbox', {
    p_west:      west,
    p_south:     south,
    p_east:      east,
    p_north:     north,
    p_limit:     2000,
    p_tolerance: tolerance,
  });

  if (error) {
    console.error('[api/map/tmja] RPC error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const featureCount = (data as { features?: unknown[] } | null)?.features?.length ?? 0;
  console.log(`[api/map/tmja] ${featureCount} tronçons dans bbox [${west.toFixed(2)},${south.toFixed(2)},${east.toFixed(2)},${north.toFixed(2)}]`);

  return new Response(JSON.stringify(data ?? { type: 'FeatureCollection', features: [] }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400', // Fix A
    },
  });
}
