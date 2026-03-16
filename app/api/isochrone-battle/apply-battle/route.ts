/**
 * POST /api/isochrone-battle/apply-battle
 *
 * Phase 2 : applique ST_Difference (bataille) sur des isochrones déjà calculés.
 * Reçoit les ring features de la Phase 1, appelle get_isochrone_battle PostGIS.
 *
 * Body: { rings: { cirfa_id, nom, lat, lng, palier, geojson }[] }
 *   geojson = JSON.stringify(geometry) — geometry GeoJSON object
 *
 * Response: { battleGeoJSON, battleBorders, nb_rings, nb_borders }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient }         from '@/lib/auth';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: { rings: { cirfa_id: string; nom: string; lat: number; lng: number; palier: number; geojson: string }[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  const { rings } = body;
  if (!Array.isArray(rings) || rings.length === 0) {
    return NextResponse.json({ error: 'rings[] requis' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // ── 1. Clip aux frontières françaises ──────────────────────────────────────
  let clippedRings = rings;
  {
    const { data: clipped, error: clipErr } = await supabase.rpc(
      'clip_rings_to_france',
      { p_rings: rings }
    );
    if (clipErr) {
      console.warn('[apply-battle] clip_rings_to_france error (fallback brut):', clipErr.message);
    } else if (Array.isArray(clipped) && clipped.length > 0) {
      clippedRings = clipped as typeof rings;
      console.log(`[apply-battle] Clip France → ${clippedRings.length}/${rings.length} rings retenus`);
    }
  }

  // ── 2. ST_Difference via get_isochrone_battle ──────────────────────────────
  console.log(`[apply-battle] get_isochrone_battle → ${clippedRings.length} rings…`);
  const { data: battleRows, error: rpcErr } = await supabase.rpc(
    'get_isochrone_battle',
    { p_rings: clippedRings }
  );

  if (rpcErr) {
    console.error('[apply-battle] Erreur RPC:', rpcErr.message);
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  const allFeatures = Array.isArray(battleRows) ? battleRows : [];

  // ── 3. Filtrer géométries dégénérées ──────────────────────────────────────
  const isValidGeom = (f: any): boolean => {
    const geom = f?.geometry;
    if (!geom) return false;
    const t = geom.type;
    if (t === 'Point' || t === 'LineString' || t === 'MultiLineString') return false;
    if (t === 'Polygon')      return (geom.coordinates?.[0]?.length ?? 0) >= 4;
    if (t === 'MultiPolygon') return (geom.coordinates?.length ?? 0) > 0;
    return false;
  };

  const ringFeatures   = allFeatures.filter((f: any) => f?.properties?.feature_type === 'ring'   && isValidGeom(f));
  const borderFeatures = allFeatures.filter((f: any) => f?.properties?.feature_type === 'border' && isValidGeom(f));
  console.log(`[apply-battle] → ${ringFeatures.length} anneaux, ${borderFeatures.length} bordures`);

  return NextResponse.json({
    battleGeoJSON: { type: 'FeatureCollection', features: ringFeatures },
    battleBorders: { type: 'FeatureCollection', features: borderFeatures },
    nb_rings:   ringFeatures.length,
    nb_borders: borderFeatures.length,
  });
}
