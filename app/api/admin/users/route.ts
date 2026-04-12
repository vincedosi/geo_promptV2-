import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const supabase = createAdminClient();

  let query = supabase.from('profiles').select('id, email, full_name, role, organization_id, created_at, organizations(name)').order('created_at', { ascending: false });

  // Admin can only see their org's users
  if (profile.role !== 'super_admin' && profile.organization_id) {
    query = query.eq('organization_id', profile.organization_id);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const users = (data ?? []).map((u: Record<string, unknown>) => ({
    ...u,
    organization_name: (u.organizations as Record<string, unknown> | null)?.name ?? null,
  }));

  return NextResponse.json(users);
}

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const body = await request.json();
  const { email, full_name, role, organization_id } = body;

  if (!email || !role) return NextResponse.json({ error: 'email and role required' }, { status: 400 });

  // Escalation protection
  if (profile.role !== 'super_admin') {
    if (role === 'super_admin') return NextResponse.json({ error: 'Cannot create super_admin' }, { status: 403 });
    if (organization_id && organization_id !== profile.organization_id) return NextResponse.json({ error: 'Cannot create in another org' }, { status: 403 });
  }

  if (role !== 'super_admin' && !organization_id) {
    return NextResponse.json({ error: 'organization_id required for non-super_admin' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Check org exists and is active
  if (organization_id) {
    const { data: org } = await supabase.from('organizations').select('active').eq('id', organization_id).single();
    if (!org?.active) return NextResponse.json({ error: 'Organization not found or inactive' }, { status: 400 });
  }

  // Create user via Supabase Auth
  const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: full_name || email.split('@')[0] },
  });

  if (authErr) {
    if (authErr.message?.includes('already')) return NextResponse.json({ error: 'Email already exists' }, { status: 409 });
    return NextResponse.json({ error: authErr.message }, { status: 500 });
  }

  // Update profile with role + org
  const { error: profErr } = await supabase.from('profiles').update({
    role, organization_id: organization_id || null, full_name: full_name || null,
  }).eq('id', authUser.user.id);

  if (profErr) console.error('[admin/users POST] profile update:', profErr.message);

  return NextResponse.json({ id: authUser.user.id, email }, { status: 201 });
}
