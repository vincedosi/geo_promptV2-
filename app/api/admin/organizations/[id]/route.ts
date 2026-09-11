/**
 * GET    /api/admin/organizations/[id] — Détail d'une organisation
 * PATCH  /api/admin/organizations/[id] — Mise à jour config workspace
 * DELETE /api/admin/organizations/[id] — Suppression organisation (super_admin only)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { z } from 'zod';
import { lireCorps } from '@/lib/api/valider-corps';

export const dynamic = 'force-dynamic';

/**
 * Les cinq seules cles que la route recopie vers la base. Toutes optionnelles :
 * `undefined` signifie « ne pas toucher », et les `if (… !== undefined)` plus
 * bas en dependent.
 *
 * `config` est une colonne `jsonb` libre : on n'en valide pas la forme, sous
 * peine de refuser des configurations qui fonctionnent aujourd'hui.
 */
const ModifierOrganisationSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  slug: z.string().optional(),
  config: z.unknown().optional(),
  active: z.boolean().optional(),
});

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const sb = createAdminClient();
  const { id } = await params;

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

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const sb = createAdminClient();
  const { id } = await params;
  const corps = await lireCorps(request, ModifierOrganisationSchema);
  if (!corps.ok) return NextResponse.json({ success: false, error: corps.message }, { status: 400 });
  const body = corps.valeur;

  // Non-super_admin can only edit their own org, and cannot touch slug/config/active
  if (profile.role !== 'super_admin') {
    if (id !== profile.organization_id) {
      return NextResponse.json({ error: 'Cannot edit another organization' }, { status: 403 });
    }
    delete body.slug;
    delete body.config;
    delete body.active;
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  // slug, config, active: super_admin only (already stripped above for non-super_admin)
  if (body.slug !== undefined) updates.slug = body.slug;
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

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  // Only super_admin can delete organizations
  if (profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'Only super_admin can delete organizations' }, { status: 403 });
  }

  const sb = createAdminClient();
  const { id } = await params;

  const { error: checkError, data: org } = await sb
    .from('organizations')
    .select('id')
    .eq('id', id)
    .single();

  if (checkError || !org) {
    return NextResponse.json({ success: false, error: 'Organisation introuvable' }, { status: 404 });
  }

  const { error } = await sb.from('organizations').delete().eq('id', id);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
