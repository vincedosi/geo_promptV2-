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
