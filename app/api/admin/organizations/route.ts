/**
 * GENESIS — API Route — /api/admin/organizations
 * GET  : Liste toutes les organisations
 * POST : Crée une organisation
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { z } from 'zod';
import { lireCorps } from '@/lib/api/valider-corps';
import { FILTRE_SOURCE_NON_SUPPRIMEE } from '@/lib/auth/getOrgSourceIds';

/**
 * `name` etait lu par `body.name?.trim()` : un nombre y levait un TypeError
 * attrape par le `catch` et rendu en 500 avec le message de l'exception. Le
 * message « Nom requis » est conserve tel quel — c'est lui qu'affiche l'UI.
 */
const CreerOrganisationSchema = z.object({
  name: z.string().trim().min(1, 'Nom requis'),
  logo_url: z.string().nullish(),
});

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
      // Une ligne par appartenance ; bornee par (comptes x espaces), quelques
      // dizaines — sous le plafond serveur de 1 000 lignes.
      supabase.from('organization_members').select('organization_id').in('organization_id', orgIds),
      supabase.from('data_sources').select('organization_id').in('organization_id', orgIds).or(FILTRE_SOURCE_NON_SUPPRIMEE),
      supabase.from('dsp_campaigns').select('organization_id').in('organization_id', orgIds),
    ]);

    const memberCounts: Record<string, number> = {};
    const sourceCounts: Record<string, number> = {};
    const campaignCounts: Record<string, number> = {};
    // `organization_id` est nullable en base : les lignes orphelines sont
    // ignorees explicitement. Le `.in(...)` ci-dessus les exclut deja, mais
    // sans cette garde une ligne nulle compterait sous la cle "null".
    for (const m of membersRes.data ?? []) {
      if (!m.organization_id) continue;
      memberCounts[m.organization_id] = (memberCounts[m.organization_id] ?? 0) + 1;
    }
    for (const s of sourcesRes.data ?? []) {
      if (!s.organization_id) continue;
      sourceCounts[s.organization_id] = (sourceCounts[s.organization_id] ?? 0) + 1;
    }
    for (const c of campaignsRes.data ?? []) {
      if (!c.organization_id) continue;
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
    const corps = await lireCorps(request, CreerOrganisationSchema);
    if (!corps.ok) return NextResponse.json({ success: false, error: corps.message }, { status: 400 });
    const body = corps.valeur;
    const supabase = createAdminClient();

    const slug = body.name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const { data, error } = await supabase
      .from('organizations')
      .insert({
        name: body.name,
        slug,
        logo_url: body.logo_url || null,
      })
      .select()
      .single();

    if (error) {
      console.error('[ORGS] Insert error:', error.message, error.code);
      if (error.code === '23505') {
        return NextResponse.json({ success: false, error: 'Un espace avec ce nom existe déjà.' }, { status: 409 });
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
