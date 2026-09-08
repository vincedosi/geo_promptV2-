import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { resolveOrgWriteAccess } from '@/lib/campaigns/access';
import { toJson } from '@/lib/supabase/rpc-json';

export const dynamic = 'force-dynamic';

const SaveZoneSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  source_type: z.string().min(1).max(100),
  source_metadata: z.record(z.unknown()).default({}),
  geometry: z.object({
    type: z.enum(['Polygon', 'MultiPolygon']),
    coordinates: z.array(z.unknown()),
  }),
  org_id: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  try {
    const body = await request.json();
    const parsed = SaveZoneSchema.safeParse(body);
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

    const { data: zoneId, error: insertError } = await supabase.rpc('create_custom_geo_zone', {
      p_name: parsed.data.name,
      p_description: parsed.data.description ?? null,
      p_org_id: parsed.data.org_id,
      p_source_type: parsed.data.source_type,
      p_source_metadata: toJson(parsed.data.source_metadata),
      p_geometry_geojson: JSON.stringify(parsed.data.geometry),
    });

    if (insertError || !zoneId) {
      console.error('[custom-geo/save]', insertError?.message);
      return NextResponse.json(
        { error: 'insert_failed', message: 'Internal server error' },
        { status: 400 },
      );
    }

    const { data: resolveData, error: resolveError } = await supabase.rpc(
      'resolve_custom_geo_zone_codes',
      { p_zone_id: zoneId, p_caller_user_id: profile.id },
    );

    if (resolveError) {
      console.error('[custom-geo/save] resolve failed:', resolveError.message);
      return NextResponse.json(
        { zone_id: zoneId, warning: 'zone_created_but_resolution_failed' },
        { status: 207 },
      );
    }

    return NextResponse.json({
      zone_id: zoneId,
      count_iris: (resolveData as { count_iris: number })?.count_iris ?? 0,
      count_cp: (resolveData as { count_cp: number })?.count_cp ?? 0,
    });
  } catch (err: unknown) {
    console.error('[custom-geo/save]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
