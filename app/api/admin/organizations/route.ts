/**
 * GENESIS — API Route — /api/admin/organizations
 * GET  : Liste toutes les organisations
 * POST : Crée une organisation
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

    let query = supabase.from('organizations').select('*').order('created_at', { ascending: true });
    // Admin non-super_admin ne voit que son org
    if (profile.role !== 'super_admin' && profile.organization_id) {
      query = query.eq('id', profile.organization_id);
    }
    const { data: orgs, error } = await query;

    if (error) throw error;

    // Enrich with member count + source count — 3 queries total regardless of org count
    const orgIds = (orgs || []).map((o) => o.id);
    const [membersRes, sourcesRes, campaignsRes] = await Promise.all([
      supabase.from('profiles').select('organization_id').in('organization_id', orgIds),
      supabase.from('data_sources').select('organization_id').in('organization_id', orgIds).neq('status', 'deleted'),
      supabase.from('dsp_campaigns').select('organization_id').in('organization_id', orgIds),
    ]);

    const memberCounts: Record<string, number> = {};
    const sourceCounts: Record<string, number> = {};
    const campaignCounts: Record<string, number> = {};
    for (const m of membersRes.data ?? []) {
      memberCounts[m.organization_id] = (memberCounts[m.organization_id] ?? 0) + 1;
    }
    for (const s of sourcesRes.data ?? []) {
      sourceCounts[s.organization_id] = (sourceCounts[s.organization_id] ?? 0) + 1;
    }
    for (const c of campaignsRes.data ?? []) {
      campaignCounts[c.organization_id] = (campaignCounts[c.organization_id] ?? 0) + 1;
    }

    const enriched = (orgs || []).map((org) => ({
      ...org,
      member_count: memberCounts[org.id] ?? 0,
      source_count: sourceCounts[org.id] ?? 0,
      campaign_count: campaignCounts[org.id] ?? 0,
    }));

    return NextResponse.json({ success: true, organizations: enriched });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  try {
    const body = await request.json();
    const supabase = createAdminClient();

    if (!body.name?.trim()) {
      return NextResponse.json({ success: false, error: 'Nom requis' }, { status: 400 });
    }

    const slug = body.name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const { data, error } = await supabase
      .from('organizations')
      .insert({
        name: body.name.trim(),
        slug,
        logo_url: body.logo_url || null,
      })
      .select()
      .single();

    if (error) {
      console.error('[ORGS] Insert error:', error.message, error.code);
      if (error.code === '23505') {
        return NextResponse.json({ success: false, error: 'Une organisation avec ce nom existe deja' }, { status: 409 });
      }
      return NextResponse.json({
        success: false,
        error: `${error.message} (code: ${error.code})`,
      }, { status: 500 });
    }

    return NextResponse.json({ success: true, organization: data });
  } catch (err: unknown) {
    console.error('[ORGS] Exception:', err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
