/**
 * GET /api/digital/codes-postaux?bbox=xmin,ymin,xmax,ymax
 * Returns GeoJSON FeatureCollection of postal code polygons (no campaign data).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const bboxStr = searchParams.get('bbox');

  let xmin = -5.5, ymin = 41.0, xmax = 10.0, ymax = 51.5;
  if (bboxStr) {
    const parts = bboxStr.split(',').map(Number);
    if (parts.length === 4 && parts.every(n => !isNaN(n))) {
      [xmin, ymin, xmax, ymax] = parts;
    }
  }

  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('get_codes_postaux_bbox', {
    p_bbox_xmin: xmin,
    p_bbox_ymin: ymin,
    p_bbox_xmax: xmax,
    p_bbox_ymax: ymax,
  });

  if (error) {
    console.error('[digital/codes-postaux]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data as unknown as Array<{
    code_postal: string;
    nom_principal: string;
    nb_communes: number;
    code_dept: string;
    pop_total: number | null;
    surface_km2: number | null;
    geometry: GeoJSON.Geometry;
  }>) ?? [];

  const fc: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: rows.map(r => ({
      type: 'Feature',
      properties: {
        code_postal: r.code_postal,
        nom: r.nom_principal,
        nb_communes: r.nb_communes,
        code_dept: r.code_dept,
        pop_total: r.pop_total,
        surface_km2: r.surface_km2,
      },
      geometry: r.geometry,
    })),
  };

  return NextResponse.json(fc, {
    headers: { 'Cache-Control': 'private, max-age=300' },
  });
}
