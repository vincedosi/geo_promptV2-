/**
 * GET /api/meteo-geo/zones?scale=region|departement|cp
 *
 * Polygones simplifiés des zones admin (GeoJSON FeatureCollection) pour la
 * choroplèthe météo — remplace les bulles aux centroïdes. Données géo stables
 * → cache navigateur 1 jour + CDN 1 semaine.
 * Échelle cp : ~6 200 polygones, ~3.8 MB avant gzip — chargée uniquement sur
 * choix explicite de granularité.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

const QuerySchema = z.object({
  scale: z.enum(['region', 'departement', 'cp']),
});

export async function GET(req: NextRequest) {
  const profile = await requireAuth(req);
  if (!profile) return authUnauthorized();

  const { searchParams } = new URL(req.url);
  const parsed = QuerySchema.safeParse({ scale: searchParams.get('scale') });
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_scale' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('get_zone_polygons', { p_scale: parsed.data.scale });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? { type: 'FeatureCollection', features: [] }, {
    headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=604800' },
  });
}
