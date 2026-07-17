/**
 * POST /api/admin/campaigns/[id]/absorb — fusionne un import orphelin dans
 * cette campagne (données + dates + totaux), puis supprime la coquille source.
 * Cible SANS données uniquement (409 sinon) : conflit d'unicité impossible.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({ source_campaign_id: z.string().uuid() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  const { id } = await params;

  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const sourceId = parsed.data.source_campaign_id;
  if (sourceId === id) return NextResponse.json({ error: 'self_absorb' }, { status: 400 });

  const supabase = createAdminClient();
  const [{ data: target }, { data: source }] = await Promise.all([
    supabase.from('dsp_campaigns').select('id, organization_id, total_tracked_ads, date_start, date_end').eq('id', id).maybeSingle(),
    supabase.from('dsp_campaigns').select('id, organization_id, dsp_source, total_tracked_ads, total_unique_impressions, countries, date_start, date_end').eq('id', sourceId).maybeSingle(),
  ]);
  if (!target || !source) return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });
  const sameOrg = target.organization_id === source.organization_id;
  const inScope = profile.role === 'super_admin' || target.organization_id === profile.organization_id;
  if (!sameOrg || !inScope) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { count } = await supabase.from('dsp_campaign_data').select('id', { count: 'exact', head: true }).eq('campaign_id', id);
  if ((count ?? 0) > 0) return NextResponse.json({ error: 'target_has_data' }, { status: 409 });

  const { error: moveErr } = await supabase
    .from('dsp_campaign_data')
    .update({ campaign_id: id })
    .eq('campaign_id', sourceId);
  if (moveErr) return NextResponse.json({ error: moveErr.message }, { status: 500 });

  await supabase.from('dsp_campaigns').update({
    total_tracked_ads: source.total_tracked_ads,
    total_unique_impressions: source.total_unique_impressions,
    countries: source.countries,
    date_start: target.date_start ?? source.date_start,
    date_end: target.date_end ?? source.date_end,
  }).eq('id', id);

  const { error: delErr } = await supabase.from('dsp_campaigns').delete().eq('id', sourceId);
  if (delErr) console.error('[absorb] coquille non supprimée:', delErr.message);

  return NextResponse.json({ moved: source.total_tracked_ads ?? 0 });
}
