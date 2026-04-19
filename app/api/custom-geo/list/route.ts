import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get('org_id');
  const sourceType = searchParams.get('source_type');
  const q = searchParams.get('q');

  if (!orgId) {
    return NextResponse.json({ error: 'org_id required' }, { status: 400 });
  }

  const supabase = createAdminClient();

  let query = supabase
    .from('custom_geo_zones')
    .select('id, name, description, source_type, source_metadata, feature_count_iris, feature_count_cp, created_at, created_by, bbox')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(500);

  if (sourceType) query = query.eq('source_type', sourceType);
  if (q) query = query.ilike('name', `%${q}%`);

  const { data, error, count } = await query;

  if (error) {
    console.error('[custom-geo/list]', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({
    zones: data ?? [],
    total: data?.length ?? 0,
  });
}
