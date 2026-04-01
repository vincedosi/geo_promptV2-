/**
 * GET /api/radio/emetteurs
 * GeoJSON des émetteurs radio avec filtres. Accessible à tous les authentifiés.
 * Query params: systeme, departement, radio_id, bbox (west,south,east,north)
 * Limite: 10 000 résultats max.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const systeme = p.get('systeme');
  const departement = p.get('departement');
  const radioId = p.get('radio_id');
  const bbox = p.get('bbox');

  const supabase = createAdminClient();

  let query = supabase
    .from('emetteurs_radio')
    .select('id, sta_nm_anfr, radio_id, systeme, frequence_mhz, puissance_w, hauteur_m, exploitant, commune, departement, rayon_couverture_m, geom')
    .not('geom', 'is', null)
    .limit(10000);

  if (systeme) query = query.eq('systeme', systeme);
  if (departement) query = query.eq('departement', departement);
  if (radioId) query = query.eq('radio_id', radioId);

  // PostgREST doesn't support spatial bbox natively — filter client-side or use RPC
  // For now, fetch and convert. For production, a proper RPC would be better.

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Convert to GeoJSON
  const features = (data ?? [])
    .filter((r: Record<string, unknown>) => r.geom)
    .map((r: Record<string, unknown>) => {
      // geom comes as WKB hex or GeoJSON from PostGIS depending on config
      // Using PostgREST, geom is returned as GeoJSON string
      let geometry: unknown = null;
      try {
        const g = r.geom;
        if (typeof g === 'string') geometry = JSON.parse(g);
        else if (typeof g === 'object') geometry = g;
      } catch { /* skip */ }

      return {
        type: 'Feature' as const,
        geometry,
        properties: {
          id: r.id,
          sta_nm_anfr: r.sta_nm_anfr,
          radio_id: r.radio_id,
          systeme: r.systeme,
          frequence_mhz: r.frequence_mhz,
          puissance_w: r.puissance_w,
          hauteur_m: r.hauteur_m,
          exploitant: r.exploitant,
          commune: r.commune,
          departement: r.departement,
          rayon_couverture_m: r.rayon_couverture_m,
        },
      };
    });

  // Client-side bbox filter if provided
  if (bbox) {
    const [west, south, east, north] = bbox.split(',').map(Number);
    if ([west, south, east, north].every(n => isFinite(n))) {
      const filtered = features.filter(f => {
        const geom = f.geometry as { coordinates?: number[] } | null;
        const coords = geom?.coordinates;
        if (!coords || coords.length < 2) return false;
        const [lng, lat] = coords;
        return lng >= west && lng <= east && lat >= south && lat <= north;
      });
      return NextResponse.json({ type: 'FeatureCollection', features: filtered });
    }
  }

  return NextResponse.json({ type: 'FeatureCollection', features });
}
