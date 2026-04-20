/**
 * POST /api/custom-geo/source/meteo
 * Wrapper autour de get_admin_filter_geometry : la meteo est agregee par zones admin
 * existantes (region/dept/cp), pas une grille distincte. Cote DB on reutilise donc
 * la RPC admin. Cote front, le sourceType reste 'meteo_grid' et les metadata portent
 * la variable + stats meteo (pas admin_filter).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const BodySchema = z.object({
  scale: z.enum(['region', 'departement', 'cp']),
  codes: z.array(z.string().min(1).max(20)).min(1).max(10000),
  variable: z.string().min(1).max(100),
  timestamp: z.string().optional().nullable(),
  stats: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
      mean: z.number().optional(),
    })
    .optional()
    .nullable(),
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
  const { data, error } = await supabase.rpc('get_admin_filter_geometry', {
    p_scale: parsed.data.scale,
    p_codes: parsed.data.codes,
  });
  if (error) {
    console.error('[custom-geo/source/meteo]', error.message);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // On remplace les metadata admin_filter par des metadata meteo dedicates
  const base = (data ?? {}) as { geometry?: unknown; metadata?: Record<string, unknown> };
  return NextResponse.json({
    geometry: base.geometry ?? null,
    metadata: {
      scale: parsed.data.scale,
      zones_count: parsed.data.codes.length,
      variable: parsed.data.variable,
      timestamp: parsed.data.timestamp ?? null,
      stats: parsed.data.stats ?? null,
    },
  });
}
