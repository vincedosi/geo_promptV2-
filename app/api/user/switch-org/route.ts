/**
 * POST /api/user/switch-org
 * Body: { organization_id: UUID | null }
 * Switches the user's active organization.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const profile = await getUserFromRequest(authHeader);
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { organization_id } = await request.json();

  const supabase = createAdminClient();

  // Validate permission
  if (organization_id === null) {
    // "All orgs" → super_admin only
    if (profile.role !== 'super_admin') {
      return NextResponse.json({ error: 'Only super_admin can view all organizations' }, { status: 403 });
    }
  } else {
    // Check membership (super_admin can switch to any org)
    if (profile.role !== 'super_admin') {
      const { data: membership } = await supabase
        .from('organization_members')
        .select('id')
        .eq('user_id', profile.id)
        .eq('organization_id', organization_id)
        .single();

      if (!membership) {
        return NextResponse.json({ error: 'Not a member of this organization' }, { status: 403 });
      }
    }
  }

  // Update active org in profiles
  const { error } = await supabase
    .from('profiles')
    .update({ organization_id })
    .eq('id', profile.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, organization_id });
}
