/**
 * GENESIS — GET/POST /api/admin/campaigns/[id]/organizations
 * Multi-org sharing for DSP campaigns via campaign_organizations pivot.
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

  const { data: campaign, error: campErr } = await supabase
    .from('dsp_campaigns')
    .select('id, organization_id')
    .eq('id', id)
    .single();
  if (campErr || !campaign) {
    return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });
  }

  const { data, error } = await supabase
    .from('campaign_organizations')
    .select('organization_id, added_at, organizations(id, name, slug)')
    .eq('campaign_id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []).map(r => {
    const o = (r as unknown as { organizations: { id: string; name: string; slug: string } }).organizations;
    return {
      id: o.id,
      name: o.name,
      slug: o.slug,
      added_at: r.added_at,
      is_owner: o.id === campaign.organization_id,
    };
  });

  return NextResponse.json({ owner_organization_id: campaign.organization_id, organizations: rows });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const orgId = body?.organization_id as string | undefined;

  if (!orgId) {
    return NextResponse.json({ error: 'organization_id requis' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: campaign } = await supabase
    .from('dsp_campaigns')
    .select('id')
    .eq('id', id)
    .single();
  if (!campaign) {
    return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });
  }

  const { data: org } = await supabase
    .from('organizations')
    .select('id, active')
    .eq('id', orgId)
    .single();
  if (!org) {
    return NextResponse.json({ error: 'Organisation introuvable' }, { status: 404 });
  }
  if (!org.active) {
    return NextResponse.json({ error: 'Organisation inactive' }, { status: 400 });
  }

  const { error } = await supabase
    .from('campaign_organizations')
    .upsert(
      { campaign_id: id, organization_id: orgId, added_by: profile.id },
      { onConflict: 'campaign_id,organization_id', ignoreDuplicates: true }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
