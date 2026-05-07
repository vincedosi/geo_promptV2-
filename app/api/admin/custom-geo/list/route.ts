/**
 * MAGELIAN — API admin /api/admin/custom-geo/list
 * Liste cross-workspace des custom_geo_zones. super_admin only.
 * Utilise le service role côté serveur pour bypass RLS.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface AdminZoneRow {
  id: string;
  name: string;
  description: string | null;
  org_id: string;
  org_name: string | null;
  source_type: string;
  source_metadata: Record<string, unknown>;
  feature_count_iris: number;
  feature_count_cp: number;
  bbox: [number, number, number, number] | null;
  created_at: string;
  created_by: string | null;
}

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get('org_id');
  const sourceType = searchParams.get('source_type');
  const q = searchParams.get('q');

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('admin_list_custom_geo_zones', {
    p_org_id: orgId || null,
    p_source_type: sourceType || null,
    p_search: q || null,
  });

  if (error) {
    console.error('[admin/custom-geo/list]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const zones = Array.isArray(data) ? (data as AdminZoneRow[]) : [];
  return NextResponse.json({ zones, total: zones.length });
}
