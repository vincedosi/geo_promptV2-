/**
 * GET /api/admin/imports — Historique global de tous les imports
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const sb = createAdminClient();

  const [oohRes, sourcesRes] = await Promise.all([
    sb.from('import_runs_ooh')
      .select('*')
      .order('lance_le', { ascending: false })
      .limit(200),
    sb.from('data_sources')
      .select('id, name, type, row_count, valid_count, error_count, import_date, status, organization_id, organizations(name, slug)')
      .order('import_date', { ascending: false })
      .limit(200),
  ]);

  const oohImports = (oohRes.data ?? []).map((r) => ({
    id: r.id,
    kind: 'ooh' as const,
    source: r.source,
    started_at: r.lance_le,
    finished_at: r.termine_le,
    status: r.statut,
    total: r.nb_total,
    inserted: r.nb_inseres,
    updated: r.nb_maj,
    duplicates: r.nb_doublons,
    errors: r.nb_erreurs,
    org_name: null,
  }));

  interface DataSourceRow {
    id: string;
    name: string;
    type?: string | null;
    row_count?: number | null;
    valid_count?: number | null;
    error_count?: number | null;
    import_date: string;
    status: string;
    organization_id?: string | null;
    organizations?: { name?: string; slug?: string } | { name?: string; slug?: string }[] | null;
  }
  const sourceImports = ((sourcesRes.data ?? []) as DataSourceRow[]).map((r) => ({
    id: r.id,
    kind: 'source' as const,
    source: r.name,
    started_at: r.import_date,
    finished_at: r.import_date,
    status: r.status === 'active' ? 'success' : r.status,
    total: r.row_count,
    inserted: r.valid_count,
    updated: 0,
    duplicates: 0,
    errors: r.error_count,
    type: r.type,
    org_name: (Array.isArray(r.organizations) ? r.organizations[0]?.name : r.organizations?.name) ?? null,
  }));

  const all = [...oohImports, ...sourceImports].sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  );

  return NextResponse.json({ success: true, imports: all });
}
