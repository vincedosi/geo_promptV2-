/**
 * MAGELIAN — API /api/digital/[campaignId]/custom-zone/[zoneId]
 * Croisement campagne DSP × zone custom (galerie /map/custom-geo) → GeoJSON + summary
 * Shape identique à /geography/[setId] : { geojson, summary } avec un seul élément dans zones.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { checkCampaignAccess, checkZoneAccess } from '@/lib/campaigns/access';
import { rpcJson } from '@/lib/supabase/rpc-json';

export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({
  campaignId: z.string().uuid(),
  zoneId: z.string().uuid(),
});

interface CustomZoneRow {
  id: string;
  nom: string;
  label: string | null;
  total_impressions: number;
  pop_value: number | null;
  ratio: number | null;
  geometry: GeoJSON.Geometry;
}

interface CustomZoneResult {
  zones: CustomZoneRow[];
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
  { params }: { params: Promise<{ campaignId: string; zoneId: string }> }
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const raw = await params;
  const parsed = ParamsSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid campaignId or zoneId' }, { status: 400 });
  }
  const { campaignId, zoneId } = parsed.data;

  const { searchParams } = new URL(request.url);
  const popField = searchParams.get('pop_field') || 'population';
  const metric = searchParams.get('metric') === 'unique' ? 'unique' : 'impressions';

  const supabase = createAdminClient();

  // Scope org : 404 uniforme (ne pas divulguer l'existence à une autre org).
  // Vérifie la campagne ET la zone (sinon fuite du nom+géométrie d'une zone tierce).
  const access = await checkCampaignAccess(supabase, profile, campaignId);
  if (access !== 'ok') return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });
  const zoneAccess = await checkZoneAccess(supabase, profile, zoneId);
  if (zoneAccess !== 'ok') return NextResponse.json({ error: 'zone_not_found' }, { status: 404 });

  const { data, error } = await supabase.rpc('aggregate_dsp_by_custom_zone', {
    p_campaign_id: campaignId,
    p_zone_id: zoneId,
    p_pop_field: popField,
    p_metric: metric,
  });

  if (error) {
    console.error('[digital/custom-zone]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let result: CustomZoneResult;
  if (typeof data === 'string') {
    try { result = JSON.parse(data); }
    catch { return NextResponse.json({ error: 'Invalid RPC response' }, { status: 500 }); }
  } else {
    result = rpcJson<CustomZoneResult>(data) as CustomZoneResult;
  }

  const zones = Array.isArray(result?.zones) ? result.zones : [];

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
    { geojson: fc, summary: result?.summary ?? null },
    { headers: { 'Cache-Control': 'private, max-age=30' } }
  );
}
