/**
 * MAGELIAN — API admin /api/admin/custom-geo/stats
 * Stats cross-workspace pour la card du header admin/sources.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { rpcJson } from '@/lib/supabase/rpc-json';

export const dynamic = 'force-dynamic';

interface AdminCustomGeoStats {
  total_zones: number;
  total_iris: number;
  total_cp: number;
  nb_workspaces: number;
  top_workspaces: Array<{ org_id: string; org_name: string | null; nb_zones: number }>;
}

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('admin_get_custom_geo_stats');

  if (error) {
    console.error('[admin/custom-geo/stats]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(rpcJson<AdminCustomGeoStats>(data) ?? {});
}
