/**
 * GEOMATIK — API /api/custom-geo/capture (POST)
 *
 * Reçoit N géométries + une transformation. Appelle transform_geometries_for_save
 * côté DB pour obtenir UNE géométrie finale, puis enchaine create + resolve codes.
 *
 * Différent de /save qui attend une géométrie déjà finale.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_BODY_BYTES = 5 * 1024 * 1024;

const CaptureSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  org_id: z.string().uuid(),
  source_type: z.string().min(1).max(100),
  source_metadata: z.record(z.unknown()).default({}),
  geometries: z.array(z.record(z.unknown())).min(1).max(100),
  transformation: z.enum(['union', 'convex_hull', 'envelope', 'raw']),
});

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  // Early size check via Content-Length header avant de lire le body
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 0 && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: 'payload_too_large', max_bytes: MAX_BODY_BYTES },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = CaptureSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  // 1. Transformer les N géométries en UNE seule via RPC
  const { data: geomJson, error: transformError } = await supabase.rpc('transform_geometries_for_save', {
    p_geometries: parsed.data.geometries,
    p_method: parsed.data.transformation,
  });

  if (transformError || !geomJson) {
    console.error('[custom-geo/capture] transform', transformError?.message);
    return NextResponse.json(
      { error: 'transform_failed', message: transformError?.message ?? 'unknown' },
      { status: 400 },
    );
  }

  // 2. Créer la zone avec la géométrie transformée
  const { data: zoneId, error: createError } = await supabase.rpc('create_custom_geo_zone', {
    p_name: parsed.data.name,
    p_description: parsed.data.description ?? null,
    p_org_id: parsed.data.org_id,
    p_source_type: parsed.data.source_type,
    p_source_metadata: {
      ...parsed.data.source_metadata,
      transformation: parsed.data.transformation,
    },
    p_geometry_geojson: JSON.stringify(geomJson),
  });

  if (createError || !zoneId) {
    console.error('[custom-geo/capture] create', createError?.message);
    return NextResponse.json(
      { error: 'create_failed', message: 'Internal server error' },
      { status: 400 },
    );
  }

  // 3. Résoudre IRIS + CP
  // Passe explicitement profile.id : la RPC est SECURITY DEFINER mais auth.uid()
  // retourne NULL via service_role. Le user a déjà été validé par requireAuth.
  const { data: resolveData, error: resolveError } = await supabase.rpc(
    'resolve_custom_geo_zone_codes',
    { p_zone_id: zoneId, p_caller_user_id: profile.id },
  );

  if (resolveError) {
    console.error('[custom-geo/capture] resolve', resolveError.message);
    return NextResponse.json(
      { zone_id: zoneId, warning: 'zone_created_but_resolution_failed' },
      { status: 207 },
    );
  }

  const resolved = (resolveData ?? {}) as { count_iris?: number; count_cp?: number };

  // 4. Calculer les stats audience (population, ménages, logements, revenus)
  // Non-bloquant : si le calcul échoue (zone trop large, timeout) on retourne
  // quand même la zone créée. Les stats peuvent être recalculées plus tard.
  const { error: statsError } = await supabase.rpc(
    'compute_zone_audience_stats',
    { p_zone_id: zoneId, p_caller_user_id: profile.id },
  );
  if (statsError) {
    console.warn('[custom-geo/capture] audience_stats', statsError.message);
  }

  return NextResponse.json({
    zone_id: zoneId,
    count_iris: resolved.count_iris ?? 0,
    count_cp: resolved.count_cp ?? 0,
    audience_computed: !statsError,
  });
}
