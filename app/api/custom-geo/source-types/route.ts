import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const orgId = new URL(request.url).searchParams.get('org_id');
  if (!orgId) return NextResponse.json({ error: 'org_id required' }, { status: 400 });

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('list_custom_geo_source_types', { p_org_id: orgId });

  if (error) {
    console.error('[custom-geo/source-types]', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json(data);
}
