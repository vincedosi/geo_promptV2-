/**
 * POST /api/custom-geo/source/admin
 * Union des geometries d'une selection admin (region/departement/cp).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const BodySchema = z.object({
  scale: z.enum(['region', 'departement', 'cp']),
  codes: z.array(z.string().min(1).max(20)).min(1).max(10000),
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
    console.error('[custom-geo/source/admin]', error.message);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data);
}
