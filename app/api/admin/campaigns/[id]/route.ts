/**
 * GENESIS — GET/DELETE /api/admin/campaigns/[id]
 * Campaign detail with stats breakdown, or delete campaign.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const { id } = await params;
  const supabase = createAdminClient();

  // Campaign record
  const { data: campaign, error } = await supabase
    .from('dsp_campaigns')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !campaign) {
    return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });
  }

  // Stats by country
  const { data: byCountry } = await supabase.rpc('get_campaign_stats_by_field', {
    p_campaign_id: id,
    p_field: 'country',
  }).select('*');

  // Stats by region
  const { data: byRegion } = await supabase.rpc('get_campaign_stats_by_field', {
    p_campaign_id: id,
    p_field: 'region',
  }).select('*');

  // Fallback: manual aggregation if RPC doesn't exist
  const byCountryFinal = byCountry ?? await aggregateField(supabase, id, 'country');
  const byRegionFinal = byRegion ?? await aggregateField(supabase, id, 'region');

  // Stats by department (first 2 chars of code_iris)
  const byDept = await aggregateDepartment(supabase, id);

  // Paginated data rows
  const page = parseInt(request.nextUrl.searchParams.get('page') ?? '1', 10);
  const limit = 50;
  const offset = (page - 1) * limit;

  const { data: rows, count: total } = await supabase
    .from('dsp_campaign_data')
    .select('*', { count: 'exact' })
    .eq('campaign_id', id)
    .order('date', { ascending: false })
    .range(offset, offset + limit - 1);

  return NextResponse.json({
    campaign,
    stats: {
      by_country: byCountryFinal,
      by_region: byRegionFinal,
      by_department: byDept,
    },
    data: {
      rows: rows ?? [],
      total: total ?? 0,
      page,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const { id } = await params;
  const supabase = createAdminClient();

  // ON DELETE CASCADE handles dsp_campaign_data
  const { data: deleted, error, count } = await supabase
    .from('dsp_campaigns')
    .delete()
    .eq('id', id)
    .select();

  console.log('[DELETE campaign]', id, '→ deleted:', deleted?.length, 'error:', error?.message, 'count:', count);

  // Verify it's really gone
  const { data: check } = await supabase.from('dsp_campaigns').select('id').eq('id', id);
  console.log('[DELETE campaign] verify after delete:', check?.length, 'remaining');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, deleted: deleted?.length ?? 0 });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const { id } = await params;
  const body = await request.json();
  const { organization_id, name } = body;

  const supabase = createAdminClient();

  // Verify campaign exists
  const { data: campaign } = await supabase.from('dsp_campaigns').select('organization_id').eq('id', id).single();
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });

  // Admin can only modify campaigns in their org
  if (profile.role !== 'super_admin') {
    if (campaign.organization_id !== profile.organization_id) {
      return NextResponse.json({ error: 'Cannot modify campaign from another org' }, { status: 403 });
    }
    if (organization_id && organization_id !== profile.organization_id) {
      return NextResponse.json({ error: 'Cannot move campaign to another org' }, { status: 403 });
    }
  }

  // Validate target org
  if (organization_id) {
    const { data: org } = await supabase.from('organizations').select('active').eq('id', organization_id).single();
    if (!org?.active) return NextResponse.json({ error: 'Organization not found or inactive' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (organization_id !== undefined) updates.organization_id = organization_id;
  if (name !== undefined) updates.name = name;

  const { error } = await supabase.from('dsp_campaigns').update(updates).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}

/* ── Helpers ─────────────────────────────────────────────────── */

async function aggregateField(
  supabase: ReturnType<typeof createAdminClient>,
  campaignId: string,
  field: 'country' | 'region'
) {
  const { data } = await supabase
    .from('dsp_campaign_data')
    .select(field)
    .eq('campaign_id', campaignId);

  if (!data) return [];

  const map = new Map<string, { tracked_ads: number; row_count: number }>();
  for (const row of data as Record<string, string>[]) {
    const key = row[field] || '(vide)';
    const existing = map.get(key) ?? { tracked_ads: 0, row_count: 0 };
    existing.row_count++;
    map.set(key, existing);
  }

  return Array.from(map.entries()).map(([key, val]) => ({
    [field]: key,
    tracked_ads: val.tracked_ads,
    row_count: val.row_count,
  }));
}

async function aggregateDepartment(
  supabase: ReturnType<typeof createAdminClient>,
  campaignId: string
) {
  const { data } = await supabase
    .from('dsp_campaign_data')
    .select('code_iris, tracked_ads')
    .eq('campaign_id', campaignId)
    .not('code_iris', 'is', null);

  if (!data) return [];

  const map = new Map<string, { tracked_ads: number; row_count: number }>();
  for (const row of data) {
    const dept = (row.code_iris as string).substring(0, 2);
    const existing = map.get(dept) ?? { tracked_ads: 0, row_count: 0 };
    existing.tracked_ads += row.tracked_ads ?? 0;
    existing.row_count++;
    map.set(dept, existing);
  }

  return Array.from(map.entries())
    .map(([code_dept, val]) => ({ code_dept, ...val }))
    .sort((a, b) => b.tracked_ads - a.tracked_ads);
}
