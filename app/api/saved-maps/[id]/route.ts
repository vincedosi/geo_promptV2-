import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { id } = params;
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('saved_maps')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
  }

  if (profile.role !== 'super_admin') {
    const ownsByUser = data.user_id && data.user_id === profile.id;
    const ownsByOrg = data.organization_id && data.organization_id === profile.organization_id;
    if (!ownsByUser && !ownsByOrg) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  return NextResponse.json(data);
}
