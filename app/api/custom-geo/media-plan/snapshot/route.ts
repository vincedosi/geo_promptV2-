/**
 * POST /api/custom-geo/media-plan/snapshot
 * Fige un snapshot versionné du plan poussé au DSP : par item (zone_id:poi_id),
 * expansé en codes postaux via get_zone_items_export, expected_share normalisé
 * INTRA-ZONE. Appelé par ZoneMediaPlanPanel au moment de la génération de l'export.
 * Scope org : membre de l'org de la campagne, ou super_admin sans org.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { CIBLE_KEYS } from '@/lib/custom-geo/cibles';
import { buildZoneSnapshotItems } from '@/lib/pacing/snapshot';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  campaign_id: z.string().uuid(),
  dsp: z.enum(['dv360', 'tiktok']),
  budget: z.number().nonnegative().nullable(),
  cpm: z.number().nonnegative().nullable(),
  cible: z.enum(CIBLE_KEYS as [string, ...string[]]),
  zones: z.array(z.object({
    zone_id: z.string(),
    zone_name: z.string(),
    items: z.array(z.object({
      item_id: z.string(),
      item_name: z.string(),
      weight: z.number().min(0).max(100),
    })).min(1),
  })).min(1).max(50),
});

interface ZoneExportItem { poi_id: string; poi_name: string; lat: number; lng: number; radius_km: number; cps: string[]; }

function scopeGuard(profile: { role: string; organization_id: string | null }, campaignOrgId: string | null): boolean {
  if (profile.role === 'super_admin' && !profile.organization_id) return true;
  return !!profile.organization_id && campaignOrgId === profile.organization_id;
}

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }
  const { campaign_id, dsp, budget, cpm, cible, zones } = parsed.data;

  const supabase = createAdminClient();

  // Scope org
  const { data: campaign, error: fetchErr } = await supabase
    .from('dsp_campaigns').select('id, organization_id').eq('id', campaign_id).single();
  if (fetchErr || !campaign) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!scopeGuard(profile, campaign.organization_id)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Version suivante (max+1). Rare concurrence → contrainte d'unicité logique côté lecture.
  const { data: versRows } = await supabase
    .from('campaign_plan_snapshot').select('version')
    .eq('campaign_id', campaign_id).order('version', { ascending: false }).limit(1);
  const version = ((versRows?.[0]?.version as number | undefined) ?? 0) + 1;

  // Expansion item→CP par zone (≤3 en parallèle : contrainte Nano). On traite les zones par lots de 3.
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < zones.length; i += 3) {
    const batch = zones.slice(i, i + 3);
    const expanded = await Promise.all(batch.map(async (z) => {
      const { data, error } = await supabase.rpc('get_zone_items_export', {
        p_zone_id: z.zone_id, p_caller_user_id: profile.id,
      }) as { data: { items: ZoneExportItem[] } | null; error: { message: string } | null };
      if (error) {
        console.warn('[media-plan/snapshot] get_zone_items_export', z.zone_id, error.message);
      }
      return { z, items: data?.items ?? [] };
    }));

    for (const { z, items } of expanded) {
      const cpsByPoi = new Map(items.map((it) => [it.poi_id, it.cps]));
      const snapshotItems = buildZoneSnapshotItems(z.zone_id, z.items, cpsByPoi);
      for (const item of snapshotItems) {
        for (const cp of item.cps) {
          rows.push({
            campaign_id, version, created_by: profile.id, dsp, budget, cpm, cible,
            zone_id: z.zone_id, zone_name: z.zone_name,
            item_id: item.item_id, item_name: item.item_name,
            item_weight: item.item_weight, expected_share: item.expected_share, postal_code: cp,
          });
        }
      }
    }
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'no_expandable_items' }, { status: 422 });
  }

  // Insert par lots de 50 (pattern lib/import/inserter.ts)
  for (let i = 0; i < rows.length; i += 50) {
    const { error: insErr } = await supabase.from('campaign_plan_snapshot').insert(rows.slice(i, i + 50));
    if (insErr) {
      // Snapshot partiel : purge best-effort pour éviter qu'un lecteur (get_campaign_pacing)
      // ne prenne des lignes incomplètes pour un snapshot complet.
      await supabase.from('campaign_plan_snapshot').delete().eq('campaign_id', campaign_id).eq('version', version);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, version, rows_inserted: rows.length });
}
