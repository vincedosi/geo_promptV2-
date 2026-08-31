/**
 * GENESIS — GET /api/admin/campaigns
 * List all DSP campaigns with aggregated stats via SQL.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { defaultCampaignName, MAGELIAN_SOURCE } from '@/lib/campaigns/blank-campaign';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/** Admin client with fetch cache disabled (Next.js caches fetch by default) */
function createNoCacheAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        fetch: (url, init) => fetch(url, { ...init, cache: 'no-store' }),
      },
    }
  );
}

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const supabase = createNoCacheAdminClient();

  // Scope au workspace actif : profile.organization_id est l'org active du
  // super_admin (null = « Toutes les orgs » via l'org switcher → vue globale).
  // Une campagne appartient au workspace si elle y est reliée (pivot
  // campaign_organizations, règle de la RLS dsp_campaigns_select) OU si elle
  // en est la propriétaire directe (dsp_campaigns.organization_id) — superset
  // qui évite de masquer une campagne possédée mais sans ligne pivot.
  const activeOrg = profile.organization_id;
  let allowedIds: string[] | null = null;
  if (activeOrg) {
    const [pivot, owned] = await Promise.all([
      supabase.from('campaign_organizations').select('campaign_id').eq('organization_id', activeOrg),
      supabase.from('dsp_campaigns').select('id').eq('organization_id', activeOrg),
    ]);
    const ids = new Set<string>();
    for (const r of pivot.data ?? []) ids.add(r.campaign_id);
    for (const r of owned.data ?? []) ids.add(r.id);
    allowedIds = [...ids];
    if (allowedIds.length === 0) {
      return NextResponse.json([], { headers: { 'Cache-Control': 'no-store' } });
    }
  }

  let campaignsQuery = supabase
    .from('dsp_campaigns')
    .select('*, organizations(name)')
    .order('created_at', { ascending: false });
  if (allowedIds) campaignsQuery = campaignsQuery.in('id', allowedIds);

  const { data: campaigns, error } = await campaignsQuery;

  logger.debug('campaigns', `found ${campaigns?.length} ${activeOrg ? `(org ${activeOrg})` : '(all orgs)'}`);

  if (error) {
    console.error('[GET /api/admin/campaigns] DB error:', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  if (!campaigns || campaigns.length === 0) {
    return NextResponse.json([], { headers: { 'Cache-Control': 'no-store' } });
  }

  // Single aggregation query — lightweight COUNT/SUM grouped by campaign
  const { data: stats } = await supabase.rpc('get_dsp_campaign_stats');

  const statsMap = new Map<string, { total_rows: number; france_rows: number; matched_iris: number }>();
  for (const row of stats ?? []) {
    statsMap.set(row.campaign_id, {
      total_rows: row.total_rows ?? 0,
      france_rows: row.france_rows ?? 0,
      matched_iris: row.matched_iris ?? 0,
    });
  }

  // Linked organizations via pivot
  const campaignIds = campaigns.map((c) => c.id);
  const { data: links } = await supabase
    .from('campaign_organizations')
    .select('campaign_id, organization_id, organizations(id, name, slug)')
    .in('campaign_id', campaignIds);

  const linksMap = new Map<string, { id: string; name: string; slug: string }[]>();
  for (const l of links ?? []) {
    const o = (l as unknown as { organizations: { id: string; name: string; slug: string } }).organizations;
    if (!o) continue;
    const arr = linksMap.get(l.campaign_id) ?? [];
    arr.push(o);
    linksMap.set(l.campaign_id, arr);
  }

  // Last data date per campaign — signal d'attention (statut & cycle de vie).
  // RPC bornée par campaignIds affichés → index scan (idx_dsp_data_campaign),
  // jamais de scan intégral de dsp_campaign_data (contrainte I/O Nano). Cf sql/095.
  const { data: lastDates } = await supabase.rpc('get_campaign_last_data_dates', { p_ids: campaignIds });
  const lastByCampaign = new Map<string, string>(
    (lastDates ?? []).map((r: { campaign_id: string; last_data_date: string }) => [r.campaign_id, r.last_data_date])
  );

  const items = campaigns.map((c) => ({
    ...c,
    organization_name: (c as Record<string, unknown>).organizations ? ((c as Record<string, unknown>).organizations as Record<string, unknown>)?.name : null,
    organizations_linked: linksMap.get(c.id) ?? [],
    total_rows: statsMap.get(c.id)?.total_rows ?? 0,
    france_rows: statsMap.get(c.id)?.france_rows ?? 0,
    matched_iris: statsMap.get(c.id)?.matched_iris ?? 0,
    last_data_date: lastByCampaign.get(c.id) ?? null,
  }));

  return NextResponse.json(items, { headers: { 'Cache-Control': 'no-store' } });
}

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  organization_id: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  let raw: unknown;
  try { raw = await request.json(); } catch { raw = {}; }
  const parsed = CreateSchema.safeParse(raw ?? {});
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const orgId = parsed.data.organization_id ?? profile.organization_id;
  if (!orgId) return NextResponse.json({ error: 'organization_required' }, { status: 400 });
  if (profile.role !== 'super_admin' && orgId !== profile.organization_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = createAdminClient();
  const { data: campaign, error } = await supabase
    .from('dsp_campaigns')
    .insert({
      name: parsed.data.name ?? defaultCampaignName(new Date()),
      dsp_source: MAGELIAN_SOURCE,
      organization_id: orgId,
      created_by: profile.id,
      total_tracked_ads: 0,
      total_unique_impressions: 0,
    })
    .select('id, name')
    .single();
  if (error || !campaign) {
    console.error('[POST /api/admin/campaigns]', error?.message);
    return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  }
  await supabase.from('campaign_organizations').upsert(
    { campaign_id: campaign.id, organization_id: orgId, added_by: profile.id },
    { onConflict: 'campaign_id,organization_id', ignoreDuplicates: true },
  );
  return NextResponse.json({ campaign }, { status: 201 });
}
