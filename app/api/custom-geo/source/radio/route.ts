/**
 * POST /api/custom-geo/source/radio
 * Union des buffers de couverture des emetteurs d'une radio.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const BodySchema = z.object({
  radio_id: z.string().uuid(),
  transmitter_ids: z.array(z.string().uuid()).max(5000).optional().nullable(),
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
  const { data, error } = await supabase.rpc('get_radio_coverage_geometry', {
    p_radio_id: parsed.data.radio_id,
    p_transmitter_ids: parsed.data.transmitter_ids ?? null,
  });
  if (error) {
    console.error('[custom-geo/source/radio]', error.message);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data);
}
