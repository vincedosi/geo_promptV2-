/**
 * POST /api/custom-geo/source/digital
 * Geometry de la zone active d'une campagne digital (filtree sur les codes ayant des impressions).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const BodySchema = z.object({
  campaign_id: z.string().uuid(),
  scale: z.enum(['region', 'departement', 'cp']),
  codes: z.array(z.string().min(1).max(20)).max(10000).optional().nullable(),
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
  const { data, error } = await supabase.rpc('get_digital_zone_geometry', {
    p_campaign_id: parsed.data.campaign_id,
    p_scale: parsed.data.scale,
    p_codes: parsed.data.codes ?? null,
  });
  if (error) {
    console.error('[custom-geo/source/digital]', error.message);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data);
}
