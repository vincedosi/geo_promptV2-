/**
 * GET/PUT /api/campaigns/[campaignId]/channels
 * Déclare les canaux de diffusion (DSP/réseaux/ad server) d'une campagne.
 * Catalogue = dsp_channel_registry ; connecté = dsp_connections de l'org.
 * Stockage : geo_strategy.channels (sous-clé namespacée, merge non destructif).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import {
  CampaignChannelsSchema, validateSelection, EMPTY_CHANNELS,
  ChannelBudgetsSchema, DspLinksSchema, pruneBudgets, pruneLinks,
  type ChannelRow, type StoredChannels,
} from '@/lib/campaigns/channels';

export const dynamic = 'force-dynamic';

const PutBodySchema = CampaignChannelsSchema.extend({
  budgets: ChannelBudgetsSchema.optional(),
  links: DspLinksSchema.optional(),
});

async function loadContext(
  supabase: ReturnType<typeof createAdminClient>, campaignId: string, userId: string,
) {
  const { data: camp } = await supabase
    .from('dsp_campaigns')
    .select('organization_id, is_demo, geo_strategy')
    .eq('id', campaignId)
    .maybeSingle();
  if (!camp) return null;
  const [regRes, connRes, profRes] = await Promise.all([
    supabase.from('dsp_channel_registry').select('code, label, category, connection_provider, active').eq('active', true),
    supabase.from('dsp_connections').select('provider').eq('organization_id', camp.organization_id).eq('status', 'connected'),
    supabase.from('profiles').select('demo_mode').eq('id', userId).maybeSingle(),
  ]);
  if (regRes.error) console.error('[campaigns/channels] registry:', regRes.error.message);
  if (connRes.error) console.error('[campaigns/channels] connexions:', connRes.error.message);
  if (profRes.error) console.error('[campaigns/channels] profil:', profRes.error.message);
  const catalog = (regRes.data ?? []) as ChannelRow[];
  const connectedProviders = ((connRes.data ?? []) as Array<{ provider: string }>).map((c) => c.provider);
  const gs = (camp.geo_strategy ?? {}) as Record<string, unknown>;
  const selected = (gs.channels as StoredChannels | undefined) ?? EMPTY_CHANNELS;
  // Démo = campagne démo OU l'utilisateur a activé son mode démo (case overlay).
  const is_demo = !!camp.is_demo || !!(profRes.data as { demo_mode?: boolean } | null)?.demo_mode;
  return { camp, catalog, connectedProviders, is_demo, selected };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ campaignId: string }> }) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { campaignId } = await params;
  const supabase = createAdminClient();
  const access = await checkCampaignAccess(supabase, profile, campaignId);
  if (access !== 'ok') return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });
  const ctx = await loadContext(supabase, campaignId, profile.id);
  if (!ctx) return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });
  return NextResponse.json({
    catalog: ctx.catalog, connectedProviders: ctx.connectedProviders,
    is_demo: ctx.is_demo, selected: ctx.selected,
  });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ campaignId: string }> }) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { campaignId } = await params;

  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const parsed = PutBodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const supabase = createAdminClient();
  const access = await checkCampaignAccess(supabase, profile, campaignId);
  if (access !== 'ok') return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });
  const ctx = await loadContext(supabase, campaignId, profile.id);
  if (!ctx) return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });

  const sel = { dsps: parsed.data.dsps, socials: parsed.data.socials, ad_server: parsed.data.ad_server };
  const check = validateSelection(sel, ctx.catalog, ctx.connectedProviders, ctx.is_demo);
  if (!check.ok) return NextResponse.json({ error: 'channel_not_available', code: check.badCode }, { status: 400 });

  // Merge non destructif : préserve media_plan etc., ET les sous-clés budgets/links
  // quand le client ne les renvoie pas (ex. StepCanaux qui ne gère que la sélection).
  const gs = (ctx.camp.geo_strategy ?? {}) as Record<string, unknown>;
  const prev = (gs.channels ?? {}) as StoredChannels;
  const budgets = pruneBudgets(parsed.data.budgets ?? prev.budgets, sel);
  const providerByCode = Object.fromEntries(ctx.catalog.map((c) => [c.code, c.connection_provider]));
  const links = pruneLinks(parsed.data.links ?? prev.links, sel, providerByCode);
  const nextChannels: StoredChannels = {
    ...sel, budgets, ...(Object.keys(links).length ? { links } : {}),
  };
  const nextGeoStrategy = { ...gs, channels: nextChannels };
  const { error } = await supabase.from('dsp_campaigns').update({ geo_strategy: nextGeoStrategy }).eq('id', campaignId);
  if (error) {
    console.error('[campaigns/channels] update:', error.message);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
