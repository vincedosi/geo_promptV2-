/**
 * GET  /api/admin/organizations/[id] — Détail d'une organisation
 * PATCH /api/admin/organizations/[id] — Mise à jour config workspace
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const sb = createAdminClient();
  const { id } = params;

  const [orgRes, membersRes, sourcesRes, allSourcesRes] = await Promise.all([
    sb.from('organizations').select('*').eq('id', id).single(),
    sb.from('profiles').select('id, email, full_name, role, created_at').eq('organization_id', id),
    sb.from('data_sources').select('id, name, type, row_count, import_date, status, shared_with').eq('organization_id', id).neq('status', 'deleted'),
    sb.from('data_sources')
      .select('id, name, type, row_count, import_date, organization_id, shared_with, organizations(name, slug)')
      .neq('organization_id', id)
      .neq('status', 'deleted')
      .order('import_date', { ascending: false }),
  ]);

  if (orgRes.error || !orgRes.data) {
    return NextResponse.json({ success: false, error: 'Organisation introuvable' }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    organization: orgRes.data,
    members: membersRes.data ?? [],
    sources: sourcesRes.data ?? [],
    available_sources: allSourcesRes.data ?? [],
  });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const sb = createAdminClient();
  const { id } = params;
  const body = await request.json();

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.config !== undefined) updates.config = body.config;
  if (body.active !== undefined) updates.active = body.active;

  const { data, error } = await sb
    .from('organizations')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, organization: data });
}
