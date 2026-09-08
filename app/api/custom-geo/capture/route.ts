/**
 * MAGELIAN — API /api/custom-geo/capture (POST)
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
import { resolveOrgWriteAccess } from '@/lib/campaigns/access';
import { toJson } from '@/lib/supabase/rpc-json';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_BODY_BYTES = 5 * 1024 * 1024;

const SubzoneSchema = z.object({
  name: z.string().min(1).max(200),
  source_ref: z.string().max(200).optional().nullable(),
  geometry: z.record(z.unknown()),
  default_multiplier: z.number().min(0).max(5).optional(),
});

const CaptureSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  org_id: z.string().uuid(),
  source_type: z.string().min(1).max(100),
  source_metadata: z.record(z.unknown()).default({}),
  geometries: z.array(z.record(z.unknown())).min(1).max(100),
  transformation: z.enum(['union', 'convex_hull', 'envelope', 'raw']),
  /**
   * Sous-zones nommées (ex: 1 par POI battle). Si fourni :
   *   • La géométrie parente est l'union des sous-zones (calculée DB-side ici).
   *   • Chaque CP/IRIS résolu est rattaché à sa sous-zone d'origine.
   *   • Le wizard Custom Bidding peut pondérer chaque sous-zone séparément.
   */
  subzones: z.array(SubzoneSchema).max(50).optional(),
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

  if (!resolveOrgWriteAccess(profile.role, profile.organization_id, parsed.data.org_id)) {
    return NextResponse.json({ error: 'forbidden_org' }, { status: 403 });
  }

  const supabase = createAdminClient();

  // 1. Transformer les N géométries en UNE seule via RPC
  const { data: geomJson, error: transformError } = await supabase.rpc('transform_geometries_for_save', {
    p_geometries: toJson(parsed.data.geometries),
    p_method: parsed.data.transformation,
  });

  if (transformError || !geomJson) {
    console.error('[custom-geo/capture] transform', transformError?.message);
    return NextResponse.json(
      { error: 'transform_failed', message: transformError?.message ?? 'unknown' },
      { status: 400 },
    );
  }

  // 2. Créer la zone (avec sous-zones si fournies)
  // Si subzones[] présent → RPC v2 qui persiste les sous-zones individuelles.
  // Sinon → RPC legacy (back-compat parfaite, comportement inchangé).
  const hasSubzones = (parsed.data.subzones?.length ?? 0) > 0;
  const subzonesPayload = hasSubzones
    ? parsed.data.subzones!.map(sz => ({
        name: sz.name,
        source_ref: sz.source_ref ?? null,
        geometry_geojson: JSON.stringify(sz.geometry),
        default_multiplier: sz.default_multiplier ?? 1.0,
      }))
    : null;

  const createRpc = hasSubzones ? 'create_custom_geo_zone_with_subzones' : 'create_custom_geo_zone';
  const createParams: Record<string, unknown> = {
    p_name: parsed.data.name,
    p_description: parsed.data.description ?? null,
    p_org_id: parsed.data.org_id,
    p_source_type: parsed.data.source_type,
    p_source_metadata: {
      ...parsed.data.source_metadata,
      transformation: parsed.data.transformation,
    },
    p_geometry_geojson: JSON.stringify(geomJson),
  };
  if (hasSubzones) createParams.p_subzones = subzonesPayload;

  const { data: zoneId, error: createError } = await supabase.rpc(createRpc, createParams);

  if (createError || !zoneId) {
    console.error('[custom-geo/capture] create', createError?.message);
    return NextResponse.json(
      { error: 'create_failed', message: 'Internal server error' },
      { status: 400 },
    );
  }

  // 3. Résoudre IRIS + CP
  // Si la zone a des sous-zones → resolve v2 (rattache chaque code à sa sous-zone).
  // Sinon → resolve legacy (équivalent fonctionnel pour zones sans sous-zones).
  const resolveRpc = hasSubzones
    ? 'resolve_custom_geo_zone_codes_with_subzones'
    : 'resolve_custom_geo_zone_codes';
  const { data: resolveData, error: resolveError } = await supabase.rpc(
    resolveRpc,
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
