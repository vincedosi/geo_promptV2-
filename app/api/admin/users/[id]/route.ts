import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const { id } = await params;
  const body = await request.json();
  const { role, organization_id, full_name } = body;

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
