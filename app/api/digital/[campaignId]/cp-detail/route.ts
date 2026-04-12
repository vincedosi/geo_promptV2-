/**
 * GET /api/digital/[campaignId]/cp-detail?cp=75001
 * Returns GeoJSON FeatureCollection of IRIS zones within a code postal.
 * Auth: getSession() (JWT local)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  await params; // consume params
  const { searchParams } = new URL(request.url);
  const cp = searchParams.get('cp');

  if (!cp || cp.length !== 5) {
    return NextResponse.json({ error: 'cp (5 digits) required' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('get_digital_cp_iris_detail', {
    p_code_postal: cp,
  });

  if (error) {
    console.error('[digital/cp-detail]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data as unknown as Array<{
    code_iris: string;
    code_commune: string;
    nom_commune: string;
    population: number;
    geometry: GeoJSON.Geometry;
  }>) ?? [];

  const fc: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: rows.map(r => ({
      type: 'Feature',
      properties: {
        code_iris: r.code_iris,
        code_commune: r.code_commune,
        nom_commune: r.nom_commune,
        population: r.population,
      },
      geometry: r.geometry,
    })),
  };

  return NextResponse.json(fc, {
    headers: { 'Cache-Control': 'private, max-age=60' },
  });
}
