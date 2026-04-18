/**
 * GEOMATIK — API /api/digital/[campaignId]/geography/[setId]
 * Croisement campagne DSP × jeu de zones → GeoJSON + summary (pct_in_zone)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

interface ZoneRow {
  id: string;
  nom: string;
  label: string | null;
  total_impressions: number;
  pop_value: number | null;
  ratio: number | null;
  geometry: GeoJSON.Geometry;
}

interface GeographyResult {
  zones: ZoneRow[];
  summary: {
    in_zone_impressions: number;
    total_impressions: number;
    pct_in_zone: number;
    total_zones: number;
    zones_with_impressions: number;
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string; setId: string }> }
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { campaignId, setId } = await params;
  if (!campaignId || !setId) {
    return NextResponse.json({ error: 'campaignId and setId required' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const popField = searchParams.get('pop_field') || 'population';
  const metric = searchParams.get('metric') === 'unique' ? 'unique' : 'impressions';

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('get_digital_geography_map', {
    p_campaign_id: campaignId,
    p_set_id: setId,
    p_pop_field: popField,
    p_metric: metric,
  });

  if (error) {
    console.error('[digital/geography]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let parsed: GeographyResult;
  if (typeof data === 'string') {
    try { parsed = JSON.parse(data); } catch { return NextResponse.json({ error: 'Invalid RPC response' }, { status: 500 }); }
  } else {
    parsed = data as GeographyResult;
  }

  const zones = Array.isArray(parsed?.zones) ? parsed.zones : [];

  const fc: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: zones.map(z => ({
      type: 'Feature',
      properties: {
        id: z.id,
        code: z.id,
        nom: z.nom,
        label: z.label,
        impressions: z.total_impressions,
        pop_value: z.pop_value,
        ratio: z.ratio,
      },
      geometry: z.geometry,
    })),
  };

  return NextResponse.json(
    { geojson: fc, summary: parsed?.summary ?? null },
    { headers: { 'Cache-Control': 'private, max-age=30' } }
  );
}
