/**
 * GENESIS — API Route — /api/admin/sources
 * GET  : Liste toutes les data sources
 * POST : Crée une nouvelle data source (appelé par l'import)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  try {
    const supabase = createAdminClient();

    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('org');
    const status = searchParams.get('status') || 'active';

    let query = supabase
      .from('data_sources')
      .select(`
        *,
        organizations(name, slug)
      `)
      .eq('status', status)
      .order('import_date', { ascending: false });

    if (orgId) {
      query = query.eq('organization_id', orgId);
    }

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json({ success: true, sources: data || [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  try {
    const body = await request.json();

    if (profile.role !== 'super_admin' && body.organization_id && body.organization_id !== profile.organization_id) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('data_sources')
      .insert({
        name: body.name,
        type: body.type,
        category: body.category || null,
        regie: body.regie || null,
        organization_id: body.organization_id || profile.organization_id,
        original_filename: body.original_filename || null,
        file_format: body.file_format || null,
        row_count: body.row_count || 0,
        valid_count: body.valid_count || 0,
        error_count: body.error_count || 0,
        mapping: body.mapping || {},
        geo_config: body.geo_config || {},
        imported_by: body.imported_by || null,
        status: 'active',
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, source: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur creation source';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
