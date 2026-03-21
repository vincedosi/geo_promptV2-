/**
 * POST   /api/admin/organizations/[id]/members — Inviter un membre
 * PATCH  /api/admin/organizations/[id]/members — Changer le rôle d'un membre
 * DELETE /api/admin/organizations/[id]/members — Retirer un membre
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const sb = createAdminClient();
  const { id: orgId } = params;
  const { email, role = 'client' } = await request.json();

  if (!email?.trim()) {
    return NextResponse.json({ success: false, error: 'Email requis' }, { status: 400 });
  }

  if (!['admin', 'client'].includes(role)) {
    return NextResponse.json({ success: false, error: 'Rôle invalide' }, { status: 400 });
  }

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

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const sb = createAdminClient();
  const { id: orgId } = params;
  const { userId, role } = await request.json();

  if (!userId || !role) {
    return NextResponse.json({ success: false, error: 'userId et role requis' }, { status: 400 });
  }

  if (!['super_admin', 'admin', 'client'].includes(role)) {
    return NextResponse.json({ success: false, error: 'Rôle invalide' }, { status: 400 });
  }

  const { error } = await sb
    .from('profiles')
    .update({ role })
    .eq('id', userId)
    .eq('organization_id', orgId);

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const sb = createAdminClient();
  const { id: orgId } = params;
  const { userId } = await request.json();

  if (!userId) {
    return NextResponse.json({ success: false, error: 'userId requis' }, { status: 400 });
  }

  // Retirer de l'org (sans supprimer le compte)
  const { error } = await sb
    .from('profiles')
    .update({ organization_id: null, role: 'client' })
    .eq('id', userId)
    .eq('organization_id', orgId);

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
