/**
 * PATCH  /api/admin/organizations/[id]/sources — Modifier une source
 * DELETE /api/admin/organizations/[id]/sources — Supprimer une source
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const sb = createAdminClient();
  const { id: orgId } = await params;
  const { sourceId, name, shared_with } = await request.json();

  if (!sourceId) return NextResponse.json({ success: false, error: 'sourceId requis' }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (shared_with !== undefined) updates.shared_with = shared_with;

  const { error } = await sb
    .from('data_sources')
    .update(updates)
    .eq('id', sourceId)
    .eq('organization_id', orgId);

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const sb = createAdminClient();
  const { id: orgId } = await params;
  const { sourceId } = await request.json();

  if (!sourceId) return NextResponse.json({ success: false, error: 'sourceId requis' }, { status: 400 });

  const { error } = await sb
    .from('data_sources')
    .update({ status: 'deleted' })
    .eq('id', sourceId)
    .eq('organization_id', orgId);

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
