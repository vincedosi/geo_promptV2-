/**
 * MAGELIAN — API /api/admin/custom-zones/[id]
 * DELETE : supprime un set (CASCADE sur geography_zones via FK)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const { id } = await params;
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid set id' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: existing, error: fetchError } = await supabase
    .from('geography_sets')
    .select('id, name, nb_zones')
    .eq('id', id)
    .maybeSingle();

  if (fetchError) {
    console.error('[admin/custom-zones/DELETE][fetch]', fetchError.message);
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: 'Set not found' }, { status: 404 });
  }

  const { error: deleteError } = await supabase
    .from('geography_sets')
    .delete()
    .eq('id', id);

  if (deleteError) {
    console.error('[admin/custom-zones/DELETE]', deleteError.message);
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({
    deleted: true,
    id,
    name: existing.name,
    removed_zones: existing.nb_zones,
  });
}
