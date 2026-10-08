/**
 * Persistance du plan média d'une zone rattaché à une campagne DSP.
 * Le plan vit dans dsp_campaigns.geo_strategy.media_plan (sous-clé namespacée —
 * geo_strategy peut porter d'autres clés legacy, jamais écrasées). 1 campagne = 1 plan.
 *
 *   GET                       → liste des campagnes de l'org (id, name, has_plan)
 *   GET  ?campaign_id=<uuid>  → plan stocké de cette campagne (ou null)
 *   POST {campaign_id, plan}  → enregistre le plan dans geo_strategy
 *   DELETE ?campaign_id=<uuid>→ détache (geo_strategy = null)
 *
 * Scope org : un membre n'agit que sur les campagnes de son organisation ;
 * un super_admin sans org voit tout. Consommé par le ZoneMediaPlanPanel.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { CIBLE_KEYS } from '@/lib/custom-geo/cibles';
import { toJson } from '@/lib/supabase/rpc-json';

export const dynamic = 'force-dynamic';

/** Plan média sérialisé dans geo_strategy. weights : clé = `<zoneId>:<poiId>` (ou zoneId). */
const PlanSchema = z.object({
  zones: z.array(z.object({ id: z.string(), name: z.string() })).max(50),
  budget: z.number().nonnegative().nullable(),
  cpm: z.number().nonnegative().nullable(),
  // Enum construit depuis la liste partagée → couvre âge + ménages + logement
  cible: z.enum(CIBLE_KEYS as [string, ...string[]]),
  weights: z.record(z.string(), z.number().min(0).max(100)),
});

const PostSchema = z.object({
  campaign_id: z.string().uuid(),
  plan: PlanSchema,
});

/** true si l'utilisateur peut agir sur cette campagne (même org, ou super_admin sans org). */
function scopeGuard(profile: { role: string; organization_id: string | null }, campaignOrgId: string | null): boolean {
  if (profile.role === 'super_admin' && !profile.organization_id) return true;
  return !!profile.organization_id && campaignOrgId === profile.organization_id;
}

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const supabase = createAdminClient();
  const campaignId = request.nextUrl.searchParams.get('campaign_id');

  // Détail d'une campagne : renvoie le plan stocké
  if (campaignId) {
    const { data, error } = await supabase
      .from('dsp_campaigns')
      .select('id, organization_id, geo_strategy')
      .eq('id', campaignId)
      .single();
    if (error || !data) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    if (!scopeGuard(profile, data.organization_id)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const gs = (data.geo_strategy ?? {}) as Record<string, unknown>;
    return NextResponse.json({ plan: gs.media_plan ?? null });
  }

  // Liste pour le sélecteur — scopée à l'org (super_admin sans org = tout)
  let query = supabase
    .from('dsp_campaigns')
    .select('id, name, dsp_source, geo_strategy, organization_id')
    .order('created_at', { ascending: false });
  if (profile.organization_id) {
    query = query.eq('organization_id', profile.organization_id);
  } else if (profile.role !== 'super_admin') {
    // Un client SANS organisation tombait dans le « super_admin sans org =
    // tout » ci-dessus et listait les campagnes de tous (2026-10-08).
    return NextResponse.json({ campaigns: [] });
  }
  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  const campaigns = (data ?? []).map(c => {
    const gs = (c.geo_strategy ?? {}) as Record<string, unknown>;
    const mp = gs.media_plan as { zones?: unknown } | undefined;
    return {
      id: c.id,
      name: c.name,
      dsp_source: c.dsp_source,
      has_plan: Array.isArray(mp?.zones) && mp.zones.length > 0,
    };
  });
  return NextResponse.json({ campaigns });
}

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const parsed = PostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }
  const { campaign_id, plan } = parsed.data;

  const supabase = createAdminClient();
  const { data: campaign, error: fetchErr } = await supabase
    .from('dsp_campaigns')
    .select('id, organization_id, geo_strategy')
    .eq('id', campaign_id)
    .single();
  if (fetchErr || !campaign) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (!scopeGuard(profile, campaign.organization_id)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Merge : préserve les autres clés de geo_strategy, remplace media_plan
  const existing = (campaign.geo_strategy ?? {}) as Record<string, unknown>;
  const mediaPlan = { ...plan, updated_at: new Date().toISOString(), updated_by: profile.id };
  const { error: updErr } = await supabase
    .from('dsp_campaigns')
    .update({ geo_strategy: { ...existing, media_plan: mediaPlan } })
    .eq('id', campaign_id);
  if (updErr) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, plan: mediaPlan });
}

export async function DELETE(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const campaignId = request.nextUrl.searchParams.get('campaign_id');
  if (!campaignId) {
    return NextResponse.json({ error: 'campaign_id requis' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: campaign, error: fetchErr } = await supabase
    .from('dsp_campaigns')
    .select('id, organization_id, geo_strategy')
    .eq('id', campaignId)
    .single();
  if (fetchErr || !campaign) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (!scopeGuard(profile, campaign.organization_id)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Retire uniquement media_plan, conserve les autres clés
  const existing = { ...((campaign.geo_strategy ?? {}) as Record<string, unknown>) };
  delete existing.media_plan;
  const { error: updErr } = await supabase
    .from('dsp_campaigns')
    .update({ geo_strategy: toJson(existing) })
    .eq('id', campaignId);
  if (updErr) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
