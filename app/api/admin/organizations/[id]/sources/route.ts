/**
 * PATCH  /api/admin/organizations/[id]/sources — Modifier une source
 * DELETE /api/admin/organizations/[id]/sources — Supprimer une source
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { z } from 'zod';
import { lireCorps } from '@/lib/api/valider-corps';

/**
 * `name` et `shared_with` restent optionnels : `undefined` signifie « ne pas
 * toucher », et les `if (… !== undefined)` plus bas en dependent.
 * `shared_with` est une colonne `uuid[]` — rien d'autre qu'un tableau d'UUID
 * n'y entre aujourd'hui sans erreur Postgres.
 */
const ModifierSourceSchema = z.object({
  sourceId: z.string().uuid(),
  name: z.string().optional(),
  shared_with: z.array(z.string().uuid()).optional(),
});

const SupprimerSourceSchema = z.object({ sourceId: z.string().uuid() });

export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const sb = createAdminClient();
  const { id: orgId } = await params;
  const corps = await lireCorps(request, ModifierSourceSchema);
  if (!corps.ok) return NextResponse.json({ success: false, error: corps.message }, { status: 400 });
  const { sourceId, name, shared_with } = corps.valeur;

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
  const corps = await lireCorps(request, SupprimerSourceSchema);
  if (!corps.ok) return NextResponse.json({ success: false, error: corps.message }, { status: 400 });
  const { sourceId } = corps.valeur;

  const { error } = await sb
    .from('data_sources')
    .update({ status: 'deleted' })
    .eq('id', sourceId)
    .eq('organization_id', orgId);

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
