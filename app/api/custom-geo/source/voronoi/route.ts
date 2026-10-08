/**
 * POST /api/custom-geo/source/voronoi
 * Retourne l'union des cellules Voronoi d'une categorie (mode standard V1).
 * TODO V2 : mode routier (cache_keys 30/60/90/120).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { sourcesVisiblesDeLaRequete, categorieEntierementVisible } from '@/lib/auth/perimetre-donnees';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const BodySchema = z.object({
  category: z.string().min(1).max(200),
  metropolitaine: z.boolean().default(true),
  filtre_ville: z.string().optional().nullable(),
  filtre_region: z.string().optional().nullable(),
  filtre_departement: z.string().optional().nullable(),
});

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });

  const supabase = createAdminClient();
  // La RPC calcule sur TOUTE la catégorie, sans notion de source : on ne la
  // lance que si l'appelant voit chacun de ses POI.
  const sources = await sourcesVisiblesDeLaRequete(request);
  if (!(await categorieEntierementVisible(supabase, parsed.data.category, sources))) {
    return NextResponse.json({ error: 'categorie_hors_perimetre' }, { status: 403 });
  }
  const { data, error } = await supabase.rpc('get_voronoi_capture_geometry', {
    p_category: parsed.data.category,
    p_metropolitaine: parsed.data.metropolitaine,
    p_filtre_ville: parsed.data.filtre_ville ?? undefined,
    p_filtre_region: parsed.data.filtre_region ?? undefined,
    p_filtre_departement: parsed.data.filtre_departement ?? undefined,
  });
  if (error) {
    console.error('[custom-geo/source/voronoi]', error.message);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data);
}
