/**
 * GET /api/user/organizations
 * Returns orgs accessible to the current user.
 * super_admin → all orgs + "Toutes"
 * others → orgs from organization_members
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const profile = await getUserFromRequest(authHeader);
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createAdminClient();

  if (profile.role === 'super_admin') {
    const { data } = await supabase.from('organizations').select('id, name, slug, logo_url').eq('active', true).order('name');
    return NextResponse.json({
      organizations: data ?? [],
      active_org_id: profile.organization_id,
      is_super_admin: true,
    });
  }

  // Get user's orgs via organization_members
  const { data: memberships } = await supabase
    .from('organization_members')
    .select('organization_id, organizations(id, name, slug, logo_url)')
    .eq('user_id', profile.id);

  const orgs = (memberships ?? [])
    .map(m => (m as unknown as { organizations: { id: string; name: string; slug: string; logo_url: string | null } }).organizations)
    .filter(Boolean);

  return NextResponse.json({
    organizations: orgs,
    active_org_id: profile.organization_id,
    is_super_admin: false,
  });
}
