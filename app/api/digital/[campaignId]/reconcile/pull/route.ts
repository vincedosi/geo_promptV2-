/**
 * POST /api/digital/[campaignId]/reconcile/pull — (re)construit le rapport DSP.
 * Démo → RPC set-based simulate_dsp_report. Sinon → runReport par canal
 * déclaré connecté, DELETE ciblé (source api) + insert idempotent.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import { runReport } from '@/lib/dsp/report';

export const dynamic = 'force-dynamic';

interface GeoStrategyChannels {
  channels?: { dsps?: string[]; socials?: string[] };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  const { campaignId } = await params;

  const supabase = createAdminClient();
  // Scope org via le helper partagé (honore le pivot campaign_organizations, 404 uniforme).
  const access = await checkCampaignAccess(supabase, profile, campaignId);
  if (access !== 'ok') return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });

  const { data: camp } = await supabase
    .from('dsp_campaigns')
    .select('id, name, is_demo, organization_id, geo_strategy, date_start, date_end')
    .eq('id', campaignId).maybeSingle();
  if (!camp) return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });
  // `organization_id` est nullable en base : sans cette garde, le `.eq(...)`
  // recevrait null et ne filtrerait pas comme une egalite.
  if (!camp.organization_id) return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });

  // Démo : génération SQL set-based (pas de connecteur, pas de fichier).
  if (camp.is_demo) {
    const { data, error } = await supabase.rpc('simulate_dsp_report', { p_campaign_id: campaignId });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = (data?.daily_rows ?? 0) + (data?.cp_rows ?? 0);
    return NextResponse.json({ results: [{ channel: 'all', status: 'simulated', rows }] });
  }

  // Prod : reporters par canal déclaré, connexions de l'org.
  const geo = (camp.geo_strategy ?? {}) as GeoStrategyChannels;
  const channels: string[] = [...(geo.channels?.dsps ?? []), ...(geo.channels?.socials ?? [])];
  const { data: conns } = await supabase
    .from('dsp_connections').select('provider').eq('organization_id', camp.organization_id);
  const connected = new Set((conns ?? []).map((c) => c.provider as string));

  const results: Array<{ channel: string; status: string; rows: number }> = [];
  for (const channel of channels) {
    const res = await runReport({
      channel, campaign: { id: camp.id, name: camp.name },
      hasConnection: connected.has(channel),
      dateStart: camp.date_start, dateEnd: camp.date_end,
    });
    if (res.status === 'api' && res.rows.length > 0) {
      await supabase.from('campaign_dsp_report')
        .delete().eq('campaign_id', campaignId).eq('channel', channel).eq('source', 'api');
      await supabase.from('campaign_dsp_report').insert(
        res.rows.map((r) => ({
          campaign_id: campaignId, date: r.date, channel: r.channel, postal_code: r.postal_code,
          impressions: r.impressions, clicks: r.clicks, spend: r.spend, source: 'api',
        })),
      );
    }
    results.push({ channel: res.channel, status: res.status, rows: res.rows.length });
  }
  return NextResponse.json({ results });
}
