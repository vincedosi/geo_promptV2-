/**
 * POST /api/custom-geo/source/composite — union des géométries de 2..20 zones
 * custom membres. Le client sauvegarde ensuite via /api/custom-geo/save
 * (source_type 'composite', metadata { kind, member_zone_ids }).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const BodySchema = z.object({
  zone_ids: z.array(z.string().uuid()).min(2).max(20),
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
  const { data, error } = await supabase.rpc('get_composite_zone_geometry', {
    p_zone_ids: parsed.data.zone_ids,
  });
  if (error) {
    console.error('[source/composite]', error.message);
    return NextResponse.json({ error: 'composite_failed' }, { status: 400 });
  }
  const result = typeof data === 'string' ? JSON.parse(data) : data;
  return NextResponse.json(result);
}
