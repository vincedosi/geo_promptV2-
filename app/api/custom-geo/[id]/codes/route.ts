/**
 * GET /api/custom-geo/[id]/codes?type=cp|iris
 *
 * Retourne la liste des codes (CPs ou IRIS) rattachés à une zone, avec le
 * subzone_id éventuel. Utilisé par le wizard Custom Bidding (Step 2) pour :
 *   • Identifier les CPs in-zone (couleur in-zone vs out-zone sur la map)
 *   • Mapper chaque CP à sa sous-zone d'origine (override par sous-zone native)
 *
 * Default type = 'cp'.
 */
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
  const url = new URL(request.url);
  const type = url.searchParams.get('type') ?? 'cp';
  if (!['cp', 'iris'].includes(type)) {
    return NextResponse.json({ error: 'invalid_type' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const access = await checkZoneAccess(supabase, profile, id);
  if (access !== 'ok') return NextResponse.json({ error: 'zone_not_found' }, { status: 404 });

  const { data, error } = await supabase
    .from('custom_geo_zone_codes')
    .select('code, subzone_id')
    .eq('zone_id', id)
    .eq('code_type', type);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    zone_id: id,
    type,
    codes: (data ?? []) as Array<{ code: string; subzone_id: string | null }>,
    count: data?.length ?? 0,
  });
}
