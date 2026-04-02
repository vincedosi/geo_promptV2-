/**
 * GET /api/radio/emetteurs
 * GeoJSON des émetteurs radio avec JOIN radios. Accessible à tous les authentifiés.
 * Query params: systeme, departement, radio_id, categorie_arcom, bbox
 * Limite: 10 000 résultats max.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Parse WKB hex (EWKB with SRID) Point to [lon, lat] */
function parseWkbPoint(hex: string): [number, number] | null {
  try {
    // EWKB format for Point with SRID 4326:
    // 01 (little-endian) 01000020 (point with SRID) E6100000 (SRID 4326)
    // then 8 bytes lon (float64 LE) + 8 bytes lat (float64 LE)
    // Total: 1 + 4 + 4 + 8 + 8 = 25 bytes = 50 hex chars
    const buf = Buffer.from(hex, 'hex');
    // Skip byte order (1) + type (4) + srid (4) = 9 bytes
    const lon = buf.readDoubleLE(9);
    const lat = buf.readDoubleLE(17);
    if (isFinite(lon) && isFinite(lat)) return [lon, lat];
  } catch { /* fallback */ }
  return null;
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const systeme = p.get('systeme');
  const departement = p.get('departement');
  const radioId = p.get('radio_id');
  const bbox = p.get('bbox');

  const supabase = createAdminClient();

  let query = supabase
    .from('emetteurs_radio')
    .select(`
      id, sta_nm_anfr, radio_id, systeme, frequence_mhz, puissance_w,
      commune, departement, rayon_couverture_m, geom,
      radios(nom, categorie_arcom, portee, genre, groupe_media)
    `)
    .not('geom', 'is', null)
    .limit(10000);

  if (systeme) query = query.eq('systeme', systeme);
  if (departement) query = query.eq('departement', departement);
  if (radioId) query = query.eq('radio_id', radioId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const features: GeoJSON.Feature[] = [];

  for (const r of data ?? []) {
    const geomRaw = r.geom as string | null;
    if (!geomRaw) continue;

    // Parse WKB hex to coordinates
    const coords = parseWkbPoint(String(geomRaw));
    if (!coords) continue;

    const radiosArr = r.radios as Array<{ nom: string; categorie_arcom: string; portee: string; genre: string; groupe_media: string }> | null;
    const radio = radiosArr?.[0] ?? null;
    const freq = Number(r.frequence_mhz);
    const displayFreq = (freq === 87.5 || freq === 108) ? null : freq;

    // Bbox filter (server-side for efficiency)
    if (bbox) {
      const [west, south, east, north] = bbox.split(',').map(Number);
      if ([west, south, east, north].every(n => isFinite(n))) {
        const [lng, lat] = coords;
        if (lng < west || lng > east || lat < south || lat > north) continue;
      }
    }

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coords },
      properties: {
        id: r.id,
        sta_nm_anfr: r.sta_nm_anfr,
        radio_id: r.radio_id,
        radio_nom: radio?.nom ?? null,
        categorie_arcom: radio?.categorie_arcom ?? null,
        portee: radio?.portee ?? null,
        genre: radio?.genre ?? null,
        groupe_media: radio?.groupe_media ?? null,
        systeme: r.systeme,
        frequence_mhz: displayFreq,
        puissance_w: r.puissance_w,
        commune: r.commune,
        departement: r.departement,
        rayon_couverture_m: r.rayon_couverture_m,
      },
    });
  }

  return NextResponse.json(
    { type: 'FeatureCollection', features },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
