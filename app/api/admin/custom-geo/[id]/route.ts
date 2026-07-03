/**
 * MAGELIAN — API admin /api/admin/custom-geo/[id]
 * DELETE : suppression admin cross-workspace (override RLS via service role).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: z.string().uuid() });

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const parsed = ParamsSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid zone id' }, { status: 400 });
  }
  const { id } = parsed.data;

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('custom_geo_zones')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[admin/custom-geo/delete]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true, id });
}
