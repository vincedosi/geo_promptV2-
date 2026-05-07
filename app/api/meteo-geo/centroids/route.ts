/**
 * GET /api/meteo-geo/centroids?scale=region|departement|cp
 *
 * Renvoie la liste des centroïdes pré-calculés de chaque zone admin pour
 * placer les bulles météo sur la carte. Pas de filtre, données géo stables
 * → cache navigateur 1 jour.
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
  const { data, error } = await supabase.rpc('get_zone_centroids', { p_scale: parsed.data.scale });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ centroids: data ?? [] }, {
    headers: { 'Cache-Control': 'public, max-age=86400' },
  });
}
