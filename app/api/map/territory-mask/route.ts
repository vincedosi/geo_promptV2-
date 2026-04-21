/**
 * POST /api/map/territory-mask
 * Retourne la geometrie d'un territoire (region/dept/cp) pour affichage en mask
 * MapLibre cote client. Reutilise la meme logique d'union admin que custom-geo.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const BodySchema = z.object({
  scale: z.enum(['region', 'departement', 'cp']),
  codes: z.array(z.string().min(1).max(20)).min(1).max(500),
});

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('get_territory_mask_geometry', {
    p_scale: parsed.data.scale,
    p_codes: parsed.data.codes,
  });
  if (error) {
    console.error('[map/territory-mask]', error.message);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data);
}
