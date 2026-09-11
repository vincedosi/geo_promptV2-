/**
 * POST   /api/admin/organizations/[id]/members — Inviter un membre
 * PATCH  /api/admin/organizations/[id]/members — Changer le rôle d'un membre
 * DELETE /api/admin/organizations/[id]/members — Retirer un membre
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { z } from 'zod';
import { lireCorps } from '@/lib/api/valider-corps';
import { RoleSchema, RoleMembreSchema } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

/**
 * Les listes de roles etaient ecrites en dur ici — `['admin', 'client']` et
 * `['super_admin', 'admin', 'client']`. Elles viennent desormais de
 * `lib/auth/roles.ts`, qui casse le build si `UserRole` evolue sans elles.
 * Les deux messages d'erreur historiques sont conserves mot pour mot.
 */
const InviterMembreSchema = z.object({
  email: z.string().trim().min(1, 'Email requis'),
  role: RoleMembreSchema.default('client'),
});

const ChangerRoleSchema = z.object({
  userId: z.string().uuid(),
  role: RoleSchema,
});

const RetirerMembreSchema = z.object({
  userId: z.string().uuid(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const sb = createAdminClient();
  const { id: orgId } = await params;
  const corps = await lireCorps(request, InviterMembreSchema);
  if (!corps.ok) return NextResponse.json({ success: false, error: corps.message }, { status: 400 });
  const { email, role } = corps.valeur;

  // Chercher l'utilisateur par email dans profiles
  const { data: existing } = await sb
    .from('profiles')
    .select('id, email, organization_id')
    .eq('email', email.trim().toLowerCase())
    .single();

  if (!existing) {
    return NextResponse.json({ success: false, error: 'Utilisateur introuvable — il doit d\'abord créer un compte' }, { status: 404 });
  }

  // Assigner l'org et le rôle
  const { error } = await sb
    .from('profiles')
    .update({ organization_id: orgId, role })
    .eq('id', existing.id);

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const sb = createAdminClient();
  const { id: orgId } = await params;
  const corps = await lireCorps(request, ChangerRoleSchema);
  if (!corps.ok) return NextResponse.json({ success: false, error: corps.message }, { status: 400 });
  const { userId, role } = corps.valeur;

  const { error } = await sb
    .from('profiles')
    .update({ role })
    .eq('id', userId)
    .eq('organization_id', orgId);

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const sb = createAdminClient();
  const { id: orgId } = await params;
  const corps = await lireCorps(request, RetirerMembreSchema);
  if (!corps.ok) return NextResponse.json({ success: false, error: corps.message }, { status: 400 });
  const { userId } = corps.valeur;

  // Retirer de l'org (sans supprimer le compte)
  const { error } = await sb
    .from('profiles')
    .update({ organization_id: null, role: 'client' })
    .eq('id', userId)
    .eq('organization_id', orgId);

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
