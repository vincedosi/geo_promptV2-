/**
 * POST /api/custom-geo/source/cluster
 * Retourne l'enveloppe convexe des POI d'un cluster.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const BodySchema = z.object({
  model_version: z.number().int().nonnegative(),
  cluster_id: z.number().int().nonnegative(),
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
  const { data, error } = await supabase.rpc('get_cluster_geometry', {
    p_model_version: parsed.data.model_version,
    p_cluster_id: parsed.data.cluster_id,
  });
  if (error) {
    console.error('[custom-geo/source/cluster]', error.message);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data);
}
