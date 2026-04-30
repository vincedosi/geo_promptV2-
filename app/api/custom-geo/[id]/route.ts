import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// GET — detail (sans géométrie)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { id } = await params;
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('custom_geo_zones')
    .select('id, name, description, org_id, source_type, source_metadata, feature_count_iris, feature_count_cp, resolved_at, created_at, updated_at, created_by, bbox, audience_stats, audience_computed_at')
    .eq('id', id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Zone not found' }, { status: 404 });
  }

  return NextResponse.json(data);
}

// PATCH — update name/description only
const PatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { id } = await params;
  const body = await request.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('custom_geo_zones')
    .update(updates)
    .eq('id', id);

  if (error) {
    console.error('[custom-geo/patch]', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ updated: true, id });
}

// DELETE
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { id } = await params;
  const supabase = createAdminClient();

  const { error } = await supabase
    .from('custom_geo_zones')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[custom-geo/delete]', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ deleted: true, id });
}
