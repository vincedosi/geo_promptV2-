/**
 * POST /api/admin/custom-geo/backfill-subzones
 *
 * Migration one-shot : pour une zone existante de type 'isochrone_battle' qui
 * n'a PAS encore de sous-zones, re-roule les isochrones depuis source_metadata
 * via ORS, peuple custom_geo_zone_subzones (1 par POI), puis re-résout les
 * codes pour rattacher chaque CP/IRIS à sa sous-zone.
 *
 * Body : { zone_id: uuid }
 * Auth : super_admin uniquement (mutate cross-org).
 *
 * Usage typique :
 *   curl -X POST http://localhost:3000/api/admin/custom-geo/backfill-subzones \
 *        -H "Authorization: Bearer $TOKEN" \
 *        -d '{"zone_id":"f001b479-..."}'
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { ORS_PROFILES } from '@/lib/isochrones/fetcher';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const BodySchema = z.object({
  zone_id: z.string().uuid(),
});

interface BattlePoi {
  poi_id: string;
  poi_name: string;
  lat: number;
  lng: number;
}

interface ZoneRow {
  id: string;
  name: string;
  source_type: string;
  source_metadata: {
    mode?: string;
    paliers?: number[];
    pois?: BattlePoi[];
  };
}

interface OrsIsochroneResponse {
  features?: Array<{ geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon }>;
}

/** Roule UN isochrone ORS pour un POI au plus grand palier (couvre tout). */
async function rollIsochroneForPoi(
  poi: BattlePoi,
  minutes: number,
  mode: string,
  apiKey: string,
): Promise<GeoJSON.Polygon | GeoJSON.MultiPolygon | null> {
  const profile = ORS_PROFILES[mode] ?? 'driving-car';
  const url = `https://api.openrouteservice.org/v2/isochrones/${profile}`;
  const body = {
    locations: [[poi.lng, poi.lat]],
    range: [minutes * 60],
    range_type: 'time',
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
      // ORS exige geo+json explicitement (renvoie 406 sinon)
      'Accept': 'application/geo+json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ORS ${res.status} pour ${poi.poi_name} : ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as OrsIsochroneResponse;
  return json.features?.[0]?.geometry ?? null;
}

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return authUnauthorized();

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }

  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ors_key_missing' }, { status: 500 });
  }

  const supabase = createAdminClient();

  // 1. Charge la zone et vérifie qu'elle est bien un battle multi-POI sans sous-zones
  const { data: zone, error: zErr } = await supabase
    .from('custom_geo_zones')
    .select('id, name, source_type, source_metadata')
    .eq('id', parsed.data.zone_id)
    .single();

  if (zErr || !zone) {
    return NextResponse.json({ error: 'zone_not_found', message: zErr?.message }, { status: 404 });
  }

  const z = zone as unknown as ZoneRow;
  if (z.source_type !== 'isochrone_battle') {
    return NextResponse.json({ error: 'not_battle_zone', source_type: z.source_type }, { status: 400 });
  }
  const pois = z.source_metadata?.pois ?? [];
  const paliers = z.source_metadata?.paliers ?? [];
  const mode = z.source_metadata?.mode ?? 'drive';
  if (pois.length < 2) {
    return NextResponse.json({ error: 'single_poi_zone', poi_count: pois.length }, { status: 400 });
  }
  const maxPalier = Math.max(...paliers);
  if (!Number.isFinite(maxPalier) || maxPalier <= 0) {
    return NextResponse.json({ error: 'invalid_paliers', paliers }, { status: 400 });
  }

  const { count: existingSubzones, error: cErr } = await supabase
    .from('custom_geo_zone_subzones')
    .select('id', { count: 'exact', head: true })
    .eq('zone_id', z.id);
  if (cErr) {
    return NextResponse.json({ error: 'check_failed', message: cErr.message }, { status: 500 });
  }
  if ((existingSubzones ?? 0) > 0) {
    return NextResponse.json({
      error: 'already_has_subzones',
      existing: existingSubzones,
    }, { status: 409 });
  }

  // 2. Roll N isochrones via ORS (séquentiellement pour rester sous le rate-limit)
  const rolled: Array<{ poi: BattlePoi; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon }> = [];
  const failed: Array<{ poi: BattlePoi; error: string }> = [];
  for (const poi of pois) {
    try {
      const geom = await rollIsochroneForPoi(poi, maxPalier, mode, apiKey);
      if (geom) rolled.push({ poi, geometry: geom });
      else failed.push({ poi, error: 'no_geometry' });
    } catch (e) {
      failed.push({ poi, error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (rolled.length === 0) {
    return NextResponse.json({
      error: 'all_isochrones_failed',
      failed,
    }, { status: 500 });
  }

  // 3. Insère les sous-zones via SQL direct (pas de RPC dédiée — on est admin)
  const inserts = rolled.map((r, idx) => ({
    zone_id: z.id,
    name: r.poi.poi_name,
    source_ref: r.poi.poi_id,
    geometry: r.geometry, // PostGIS accepte GeoJSON via cast implicite
    ordering: idx,
    default_multiplier: 1.0,
  }));

  // Supabase JS ne sait pas caster GeoJSON → geometry directement. On passe par
  // un INSERT SQL avec ST_GeomFromGeoJSON pour chaque ligne.
  for (const ins of inserts) {
    const { error: insErr } = await supabase.rpc('insert_subzone_from_geojson', {
      p_zone_id: ins.zone_id,
      p_name: ins.name,
      p_source_ref: ins.source_ref,
      p_geometry_geojson: JSON.stringify(ins.geometry),
      p_ordering: ins.ordering,
      p_default_multiplier: ins.default_multiplier,
    });
    if (insErr) {
      return NextResponse.json({
        error: 'insert_subzone_failed',
        subzone_name: ins.name,
        message: insErr.message,
      }, { status: 500 });
    }
  }

  // 4. Re-résout les codes avec rattachement par sous-zone
  const { data: resolveData, error: resolveErr } = await supabase.rpc(
    'resolve_custom_geo_zone_codes_with_subzones',
    { p_zone_id: z.id, p_caller_user_id: profile.id },
  );
  if (resolveErr) {
    return NextResponse.json({
      error: 'resolve_failed',
      subzones_inserted: rolled.length,
      message: resolveErr.message,
    }, { status: 500 });
  }

  return NextResponse.json({
    zone_id: z.id,
    zone_name: z.name,
    pois_rolled: rolled.length,
    pois_failed: failed.length,
    failed_details: failed,
    resolve: resolveData,
  });
}
