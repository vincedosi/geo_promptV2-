/**
 * GET /api/custom-geo/[id]/preview
 *   → GeoJSON simplifié de la zone pour la mini-map dans le wizard.
 *   Charge la geometry de custom_geo_zones + bbox + counts pour affichage léger.
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
  const supabase = createAdminClient();

  const access = await checkZoneAccess(supabase, profile, id);
  if (access !== 'ok') return NextResponse.json({ error: 'zone_not_found' }, { status: 404 });

  const { data, error } = await supabase
    .from('custom_geo_zones')
    .select('id, name, source_type, bbox, feature_count_iris, feature_count_cp, geometry')
    .eq('id', id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Zone introuvable' }, { status: 404 });

  return NextResponse.json({
    id: data.id,
    name: data.name,
    source_type: data.source_type,
    bbox: data.bbox,
    feature_count_iris: data.feature_count_iris,
    feature_count_cp: data.feature_count_cp,
    geometry: data.geometry,
  });
}
