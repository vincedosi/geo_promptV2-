/**
 * POST /api/custom-geo/source/indicator-threshold
 * Résout les codes passant le seuil (RPC registre) puis matérialise la
 * géométrie via les RPC existantes (IRIS ou CP). Le client sauvegarde ensuite
 * via /api/custom-geo/save (source_type 'indicator_threshold' + définition).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const BodySchema = z.object({
  indicator_code: z.string().min(1).max(100),
  operator: z.enum(['>=', '<=']),
  threshold: z.number().finite(),
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
  const { data: selRaw, error: selError } = await supabase.rpc('get_indicator_threshold_selection', {
    p_indicator_code: parsed.data.indicator_code,
    p_operator: parsed.data.operator,
    p_threshold: parsed.data.threshold,
    p_preview: false,
  });
  if (selError) {
    console.error('[source/indicator-threshold] selection:', selError.message);
    return NextResponse.json({ error: 'selection_failed' }, { status: 400 });
  }
  const sel = (typeof selRaw === 'string' ? JSON.parse(selRaw) : selRaw) as {
    codes: string[]; count: number; truncated: boolean; scale: 'iris' | 'cp';
  };
  if (!sel.codes.length) return NextResponse.json({ error: 'empty_selection' }, { status: 400 });
  if (sel.truncated) return NextResponse.json({ error: 'selection_too_large', count: sel.count }, { status: 400 });

  let geometry: unknown;
  if (sel.scale === 'iris') {
    const { data, error } = await supabase.rpc('get_iris_selection_geometry', { p_iris_codes: sel.codes });
    if (error) {
      console.error('[source/indicator-threshold] geom iris:', error.message);
      return NextResponse.json({ error: 'geometry_failed' }, { status: 400 });
    }
    geometry = data;
  } else {
    // CP : même RPC que la source météo (signature : p_scale, p_codes)
    const { data, error } = await supabase.rpc('get_admin_filter_geometry', {
      p_scale: 'cp', p_codes: sel.codes,
    });
    if (error) {
      console.error('[source/indicator-threshold] geom cp:', error.message);
      return NextResponse.json({ error: 'geometry_failed' }, { status: 400 });
    }
    geometry = data;
  }
  return NextResponse.json({ geometry, count: sel.count, truncated: sel.truncated, scale: sel.scale });
}
