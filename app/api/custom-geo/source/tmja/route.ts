/**
 * POST /api/custom-geo/source/tmja
 * Buffer 250m autour des LineStrings TMJA dans une bbox, union -> MultiPolygon.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const BodySchema = z.object({
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  buffer_meters: z.number().int().min(50).max(2000).default(250),
  min_tmja: z.number().int().min(0).max(1000000).default(0),
  limit: z.number().int().min(1).max(50000).default(10000),
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
  const { data, error } = await supabase.rpc('get_tmja_capture_geometry', {
    p_west: w, p_south: s, p_east: e, p_north: n,
    p_buffer_meters: parsed.data.buffer_meters,
    p_min_tmja: parsed.data.min_tmja,
    p_limit: parsed.data.limit,
  });
  if (error) {
    console.error('[custom-geo/source/tmja]', error.message);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data);
}
