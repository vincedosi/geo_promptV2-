import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { lireCorps } from '@/lib/api/valider-corps';
import { RoleSchema } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

/**
 * Chaque champ est optionnel : la route distingue `undefined` (ne pas toucher)
 * de `null` (effacer), et cette distinction porte le comportement des trois
 * `if (… !== undefined)` plus bas. `.optional()` la preserve exactement.
 */
const ModifierUtilisateurSchema = z.object({
  role: RoleSchema.optional(),
  organization_id: z.string().uuid().nullable().optional(),
  full_name: z.string().nullable().optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const { id } = await params;
  const corps = await lireCorps(request, ModifierUtilisateurSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });
  const { role, organization_id, full_name } = corps.valeur;

  const supabase = createAdminClient();

  // Fetch target user
  const { data: target } = await supabase.from('profiles').select('role, organization_id').eq('id', id).single();
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Security checks for non-super-admin
  if (profile.role !== 'super_admin') {
    if (target.role === 'super_admin') return NextResponse.json({ error: 'Cannot modify super_admin' }, { status: 403 });
    if (target.organization_id !== profile.organization_id) return NextResponse.json({ error: 'Cannot modify user from another org' }, { status: 403 });
    if (role === 'super_admin') return NextResponse.json({ error: 'Cannot promote to super_admin' }, { status: 403 });
    if (organization_id && organization_id !== profile.organization_id) return NextResponse.json({ error: 'Cannot move user to another org' }, { status: 403 });
  }

  const updates: Record<string, unknown> = {};
  if (full_name !== undefined) updates.full_name = full_name;
  if (role !== undefined) updates.role = role;
  if (organization_id !== undefined) updates.organization_id = organization_id;

  const { error } = await supabase.from('profiles').update(updates).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const { id } = await params;
  if (id === profile.id) return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 });

  const supabase = createAdminClient();
  const { data: target } = await supabase.from('profiles').select('role, organization_id').eq('id', id).single();
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  if (profile.role !== 'super_admin') {
    if (target.role === 'super_admin' || target.role === 'admin') return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    if (target.organization_id !== profile.organization_id) return NextResponse.json({ error: 'Cannot delete user from another org' }, { status: 403 });
  }

  const { error } = await supabase.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
