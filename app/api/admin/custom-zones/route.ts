/**
 * GEOMATIK — API /api/admin/custom-zones
 * GET : liste les geography_sets (toutes orgs, super_admin only)
 *
 * Query params :
 *   - org_id (uuid, optionnel) — filtre par organisation
 *   - q (string, optionnel)    — recherche textuelle sur name
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

interface CustomZoneSetRow {
  id: string;
  name: string;
  description: string | null;
  organization_id: string | null;
  source_type: string;
  nb_zones: number;
  created_at: string;
  created_by: string | null;
  organizations: { name: string; slug: string } | null;
}

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get('org_id');
  const q = searchParams.get('q')?.trim();

  const supabase = createAdminClient();

  let query = supabase
    .from('geography_sets')
    .select(`
      id,
      name,
      description,
      organization_id,
      source_type,
      nb_zones,
      created_at,
      created_by,
      organizations:organization_id ( name, slug )
    `)
    .order('created_at', { ascending: false });

  if (orgId) {
    if (orgId === 'null') {
      query = query.is('organization_id', null);
    } else {
      query = query.eq('organization_id', orgId);
    }
  }
  if (q) {
    query = query.ilike('name', `%${q}%`);
  }

  const { data, error } = await query.returns<CustomZoneSetRow[]>();

  if (error) {
    console.error('[admin/custom-zones/GET]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  const sets = rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    organization_id: r.organization_id,
    organization_name: r.organizations?.name ?? null,
    organization_slug: r.organizations?.slug ?? null,
    source_type: r.source_type,
    feature_count: r.nb_zones,
    created_at: r.created_at,
    created_by: r.created_by,
  }));

  return NextResponse.json({
    sets,
    total: sets.length,
    total_features: sets.reduce((sum, s) => sum + s.feature_count, 0),
  });
}
