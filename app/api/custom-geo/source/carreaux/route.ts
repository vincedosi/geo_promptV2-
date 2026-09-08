/**
 * POST /api/custom-geo/source/carreaux
 * Union des carreaux Filosofi dans une bbox (limite max_rows), filtrage optionnel
 * par bornes de valeur (correspondant au bucket selectionne cote front).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

const AdminScopeSchema = z
  .object({
    scale: z.enum(['region', 'departement', 'cp', 'ville']),
    codes: z.array(z.string()).min(1).max(500),
  })
  .nullable()
  .optional();

const BodySchema = z.object({
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  zoom_level: z.number().int().min(7).max(18).default(10),
  indicateur: z.string().min(1).max(100).default('population_totale'),
  max_rows: z.number().int().min(1).max(20000).default(5000),
  value_min: z.number().nullable().optional(),
  value_max: z.number().nullable().optional(),
  admin_scope: AdminScopeSchema,
});

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });

  const [w, s, e, n] = parsed.data.bbox;
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('get_carreaux_capture_geometry', {
    p_west: w, p_south: s, p_east: e, p_north: n,
    p_zoom_level: parsed.data.zoom_level,
    p_indicateur: parsed.data.indicateur,
    p_max_rows: parsed.data.max_rows,
    p_value_min: parsed.data.value_min ?? undefined,
    p_value_max: parsed.data.value_max ?? undefined,
    p_admin_scope: parsed.data.admin_scope ?? null,
  });
  if (error) {
    console.error('[custom-geo/source/carreaux]', error.message);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data);
}
