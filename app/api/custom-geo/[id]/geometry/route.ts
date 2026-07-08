import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkZoneAccess } from '@/lib/campaigns/access';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { id } = await params;
  const supabase = createAdminClient();

  const access = await checkZoneAccess(supabase, profile, id);
  if (access !== 'ok') return NextResponse.json({ error: 'zone_not_found' }, { status: 404 });

  const { data, error } = await supabase.rpc('get_custom_geo_zone_feature', { p_zone_id: id });

  if (error || !data) {
    console.error('[custom-geo/geometry]', error?.message);
    return NextResponse.json({ error: 'Zone not found' }, { status: 404 });
  }

  return NextResponse.json(data);
}
