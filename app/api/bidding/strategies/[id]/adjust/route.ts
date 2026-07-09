/**
 * POST /api/bidding/strategies/[id]/adjust
 * Action « Ajuster » : patch partiel de la stratégie active SANS re-wizard,
 * budgets PAR CANAL (global = somme serveur), puis re-push bidding via
 * connecteurs (lib/dsp/push) et historisation :
 *   - strategy_changes (audit fin, change_type='adjusted', via log_strategy_change)
 *   - bidding_agent_actions (événement consolidé intent='manual_adjust' → journal + chat)
 *   - dsp_api_logs (une ligne par tentative de push, provider connu uniquement)
 * Un échec de push N'ANNULE PAS l'ajustement (succès partiel, statut failed).
 * Nano : orchestration séquentielle, jamais >3 requêtes en parallèle.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkStrategyAccess, checkZoneAccess } from '@/lib/campaigns/access';
import { effectiveCampaignStatus } from '@/lib/campaigns/status';
import {
  CampaignChannelsSchema, ChannelBudgetsSchema, DspLinksSchema,
  validateSelection, pruneBudgets, sumBudgets,
  type ChannelRow, type StoredChannels, type CampaignChannels, type DspLinks,
} from '@/lib/campaigns/channels';
import { runPush } from '@/lib/dsp/push';
import type { BiddingPushResult } from '@/lib/dsp/push/types';
import type { WeightedBiddingTier } from '@/lib/digital/dv360-bidding-script';
import type { Dv360ConnectionRow } from '@/lib/dsp/dv360/client';
import { logDspEvent } from '@/lib/dsp/logger';
import type { DspProvider } from '@/types/dsp';
import { INTENSITY_CURVES, TARGET_VARIABLE_CODE } from '@/app/campaigns/[id]/_components/steps/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const AdjustSchema = z.object({
  reason: z.string().min(3).max(2000),
  changes: z.object({
    channel_budgets: ChannelBudgetsSchema.optional(),
    forecast_cpm: z.number().positive().optional(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    execution_mode: z.enum(['monitor_only', 'suggest', 'auto']).optional(),
    intensity: z.enum(['doux', 'marque', 'fort']).optional(),
    zone: z.object({
      scope_type: z.enum(['national', 'custom_zone']),
      zone_id: z.string().uuid().nullable(),
    }).optional(),
    channels: CampaignChannelsSchema.optional(),
  }).refine((o) => Object.keys(o).length > 0, { message: 'aucun_changement' }),
  links: DspLinksSchema.optional(),
});

const KNOWN_PROVIDERS: ReadonlySet<string> = new Set(['dv360', 'meta', 'tiktok', 'ttd']);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { id } = await params;

  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const parsed = AdjustSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  const { reason, changes } = parsed.data;
  if (changes.start_date && changes.end_date && changes.start_date > changes.end_date) {
    return NextResponse.json({ error: 'dates_incoherentes' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const access = await checkStrategyAccess(supabase, profile, id);
  if (access !== 'ok') return NextResponse.json({ error: 'strategy_not_found' }, { status: 404 });

  // ── Gardes : stratégie active + campagne ni en pause ni clôturée ─────────────
  const { data: strategy } = await supabase
    .from('bidding_strategies')
    .select('id, campaign_id, status, total_budget, forecast_cpm, start_date, end_date, execution_mode, in_zone_weights, out_zone_weights, scope_type, zone_id')
    .eq('id', id).single();
  if (!strategy) return NextResponse.json({ error: 'strategy_not_found' }, { status: 404 });
  if (strategy.status !== 'active') {
    return NextResponse.json({ error: 'strategy_not_active', status: strategy.status }, { status: 409 });
  }

  const { data: campaign } = await supabase
    .from('dsp_campaigns')
    .select('id, name, organization_id, is_demo, geo_strategy, date_start, date_end, status_override')
    .eq('id', strategy.campaign_id).single();
  if (!campaign) return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });
  const today = new Date().toISOString().slice(0, 10);
  const campStatus = effectiveCampaignStatus(campaign as never, today);
  if (campStatus === 'en_pause' || campaign.status_override === 'ended' || campStatus === 'archivee') {
    return NextResponse.json({ error: 'campaign_not_adjustable', status: campStatus }, { status: 409 });
  }

  const { data: profRow } = await supabase.from('profiles').select('demo_mode').eq('id', profile.id).maybeSingle();
  const isDemo = !!campaign.is_demo || !!(profRow as { demo_mode?: boolean } | null)?.demo_mode;

  if (changes.zone?.zone_id) {
    const zoneAccess = await checkZoneAccess(supabase, profile, changes.zone.zone_id);
    if (zoneAccess !== 'ok') return NextResponse.json({ error: 'zone_not_found' }, { status: 404 });
  }

  // ── Canaux / budgets : état stocké + nouvel état ─────────────────────────────
  const gs = (campaign.geo_strategy ?? {}) as Record<string, unknown>;
  const prevChannels = (gs.channels ?? { dsps: [], socials: [], ad_server: null }) as StoredChannels;
  const sel: CampaignChannels = changes.channels ?? {
    dsps: prevChannels.dsps ?? [], socials: prevChannels.socials ?? [], ad_server: prevChannels.ad_server ?? null,
  };

  const { data: regRows, error: regErr } = await supabase
    .from('dsp_channel_registry')
    .select('code, label, category, connection_provider, active')
    .eq('active', true);
  if (regErr) {
    console.error('[adjust] registry:', regErr.message);
    return NextResponse.json({ error: 'registry_unavailable' }, { status: 500 });
  }
  const catalog = (regRows ?? []) as ChannelRow[];

  if (changes.channels) {
    const { data: connProvRows, error: connProvErr } = await supabase
      .from('dsp_connections').select('provider')
      .eq('organization_id', campaign.organization_id).eq('status', 'connected');
    if (connProvErr) console.error('[adjust] connected-providers:', connProvErr.message);
    const connectedProviders = ((connProvRows ?? []) as Array<{ provider: string }>).map((c) => c.provider);
    const check = validateSelection(sel, catalog, connectedProviders, isDemo);
    if (!check.ok) return NextResponse.json({ error: 'channel_not_available', code: check.badCode }, { status: 400 });
  }

  const prevBudgets = prevChannels.budgets ?? {};
  const nextBudgets = pruneBudgets(changes.channel_budgets ?? prevBudgets, sel);
  const budgetsChanged = JSON.stringify(prevBudgets) !== JSON.stringify(nextBudgets);
  const newTotal = sumBudgets(nextBudgets);
  if ((changes.channel_budgets || changes.channels) && newTotal <= 0) {
    return NextResponse.json({ error: 'budget_total_nul' }, { status: 400 });
  }

  // ── Patch partiel bidding_strategies (même mécanique que la route PATCH) ─────
  const updates: Record<string, unknown> = {};
  const changesLog: Array<{ field: string; old: unknown; new: unknown }> = [];
  const push = (field: string, oldV: unknown, newV: unknown) => {
    if (JSON.stringify(oldV) !== JSON.stringify(newV)) { updates[field] = newV; changesLog.push({ field, old: oldV, new: newV }); }
  };
  if (budgetsChanged) push('total_budget', strategy.total_budget, newTotal);
  if (changes.forecast_cpm !== undefined) push('forecast_cpm', strategy.forecast_cpm, changes.forecast_cpm);
  if (changes.start_date !== undefined) push('start_date', strategy.start_date ? String(strategy.start_date).slice(0, 10) : null, changes.start_date);
  if (changes.end_date !== undefined) push('end_date', strategy.end_date ? String(strategy.end_date).slice(0, 10) : null, changes.end_date);
  if (changes.execution_mode !== undefined) push('execution_mode', strategy.execution_mode, changes.execution_mode);
  if (changes.intensity !== undefined) {
    push('in_zone_weights', strategy.in_zone_weights, {
      mode: 'by_insee_variable', variable_code: TARGET_VARIABLE_CODE,
      curve: INTENSITY_CURVES[changes.intensity],
    });
  }
  if (changes.zone !== undefined) {
    push('scope_type', strategy.scope_type, changes.zone.scope_type);
    push('zone_id', strategy.zone_id, changes.zone.zone_id);
  }

  if (Object.keys(updates).length > 0) {
    const { error: uErr } = await supabase.from('bidding_strategies').update(updates).eq('id', id);
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
    const weightChanged = 'in_zone_weights' in updates || 'zone_id' in updates || 'scope_type' in updates;
    if (weightChanged) {
      const { error: rpcErr } = await supabase.rpc('apply_zone_weights_to_strategy', {
        p_strategy_id: id,
        p_in_weights: (updates.in_zone_weights as Record<string, unknown>) ?? strategy.in_zone_weights ?? {},
        p_out_weights: strategy.out_zone_weights ?? {},
      });
      if (rpcErr) return NextResponse.json({ error: `apply_zone_weights: ${rpcErr.message}` }, { status: 500 });
    }
  }

  // ── Canaux + budgets + links → geo_strategy.channels (merge non destructif) ──
  const prevLinks = prevChannels.links;
  const nextLinks: DspLinks | undefined = parsed.data.links
    ? { ...prevLinks, ...parsed.data.links }
    : prevLinks;
  const channelsPayloadChanged = changes.channels !== undefined || budgetsChanged || parsed.data.links !== undefined;
  if (channelsPayloadChanged) {
    const nextChannels: StoredChannels = { ...sel, budgets: nextBudgets, ...(nextLinks ? { links: nextLinks } : {}) };
    const { error: gErr } = await supabase.from('dsp_campaigns')
      .update({ geo_strategy: { ...gs, channels: nextChannels } }).eq('id', campaign.id);
    if (gErr) return NextResponse.json({ error: gErr.message }, { status: 500 });
    if (changes.channels) changesLog.push({ field: 'channels', old: { dsps: prevChannels.dsps, socials: prevChannels.socials, ad_server: prevChannels.ad_server }, new: sel });
    if (budgetsChanged) changesLog.push({ field: 'channel_budgets', old: prevBudgets, new: nextBudgets });
  }

  // ── Audit : une ligne strategy_changes par champ modifié (y compris canaux/budgets) ──
  if (changesLog.length > 0) {
    for (const ch of changesLog) {
      await supabase.rpc('log_strategy_change', {
        p_strategy_id: id, p_change_type: 'adjusted', p_field_path: ch.field,
        p_old_value: ch.old as never, p_new_value: ch.new as never,
        p_reason: reason, p_triggered_by: 'user',
      });
    }
  }

  // ── Snapshot v+1 (RPC serveur — copie du dernier plan avec budgets/cpm/période à jour)
  let snapshotVersion: number | null = null;
  const { data: dupRows, error: dupErr } = await supabase.rpc('duplicate_plan_snapshot', {
    p_campaign_id: campaign.id,
    p_created_by: profile.id,
    p_budgets: nextBudgets,
    p_cpm: changes.forecast_cpm ?? null,
    p_period_start: changes.start_date ?? null,
    p_period_end: changes.end_date ?? null,
  });
  if (dupErr) console.error('[adjust] duplicate_plan_snapshot:', dupErr.message);
  const dup = Array.isArray(dupRows) ? dupRows[0] as { new_version: number | null } | undefined : undefined;
  snapshotVersion = dup?.new_version ?? null;

  // ── Tiers pour le script pondéré (depuis le snapshot v+1, borné) ─────────────
  const tiersByDsp = new Map<string, WeightedBiddingTier[]>();
  let zoneName = 'Zone de la stratégie';
  if (snapshotVersion != null) {
    const { data: snapRows, error: snapErr } = await supabase
      .from('campaign_plan_snapshot')
      .select('dsp, zone_name, item_id, item_name, item_weight, postal_code')
      .eq('campaign_id', campaign.id).eq('version', snapshotVersion).limit(5000);
    if (snapErr) console.error('[adjust] snapshot-rows:', snapErr.message);
    const byKey = new Map<string, { dsp: string; name: string; score: number; cps: string[] }>();
    for (const r of (snapRows ?? []) as Array<{ dsp: string; zone_name: string; item_id: string; item_name: string; item_weight: number; postal_code: string }>) {
      zoneName = r.zone_name || zoneName;
      const k = `${r.dsp}:${r.item_id}`;
      const cur = byKey.get(k) ?? { dsp: r.dsp, name: r.item_name, score: (r.item_weight ?? 0) / 100, cps: [] };
      cur.cps.push(r.postal_code);
      byKey.set(k, cur);
    }
    for (const t of byKey.values()) {
      const list = tiersByDsp.get(t.dsp) ?? [];
      list.push({ name: t.name, cps: t.cps, score: t.score });
      tiersByDsp.set(t.dsp, list);
    }
  }

  // ── Push par canal (séquentiel) ──────────────────────────────────────────────
  const providerByCode = new Map(catalog.map((c) => [c.code, c.connection_provider]));
  const neededProviders = [...new Set([...sel.dsps, ...sel.socials]
    .map((code) => providerByCode.get(code)).filter((p): p is string => !!p))];
  let connByProvider = new Map<string, Dv360ConnectionRow>();
  if (neededProviders.length > 0) {
    const { data: connRows, error: connErr } = await supabase
      .from('dsp_connections')
      .select('provider, auth_method, credentials_encrypted, oauth_refresh_token_encrypted, oauth_client_id, oauth_client_secret_encrypted')
      .eq('organization_id', campaign.organization_id).eq('status', 'connected')
      .in('provider', neededProviders);
    if (connErr) console.error('[adjust] connections:', connErr.message);
    connByProvider = new Map(((connRows ?? []) as Array<Dv360ConnectionRow & { provider: string }>)
      .map((c) => [c.provider, c]));
  }

  const pushes: BiddingPushResult[] = [];
  for (const code of [...sel.dsps, ...sel.socials]) {
    const provider = providerByCode.get(code) ?? null;
    const connection = provider ? (connByProvider.get(provider) ?? null) : null;
    const started = Date.now();
    const result = await runPush({
      channel: code,
      campaign: { id: campaign.id, name: campaign.name, is_demo: !!campaign.is_demo },
      channelBudget: nextBudgets[code] ?? null,
      budgetChanged: budgetsChanged && prevBudgets[code] !== nextBudgets[code],
      zoneName,
      tiers: tiersByDsp.get(code) ?? tiersByDsp.get('dv360') ?? [],
      connection,
      links: nextLinks ?? null,
      isDemo,
    });
    pushes.push(result);
    if (provider && KNOWN_PROVIDERS.has(provider) && campaign.organization_id) {
      await logDspEvent({
        orgId: campaign.organization_id, provider: provider as DspProvider,
        category: 'api_call', level: result.status === 'failed' ? 'error' : 'info',
        action: 'bidding_push', durationMs: Date.now() - started,
        message: `${result.status} — ${result.detail}`.slice(0, 500),
        detail: { channel: code, snapshot_version: snapshotVersion, ...('budget' in result.payload_summary ? { budget: result.payload_summary.budget } : {}) },
      });
    }
  }

  // ── Événement consolidé → journal + chat (bidding_agent_actions) ─────────────
  // action_taken et trigger_source sont des énumérations contraintes en base
  // (CHECK), PAS du texte libre :
  //   - action_taken : none/suggested/auto_applied/human_approved/human_rejected
  //     → un ajustement manuel appliqué immédiatement par l'utilisateur = 'human_approved'
  //       (même sémantique que app/api/agent/apply-recommendation/route.ts).
  //   - trigger_source : user_chat/proactive/api (cf. lib/agent/types.ts TriggerSource)
  //     → ce panneau n'est pas le chat, donc 'api'.
  // Le résumé des champs modifiés part dans recommendations.summary pour ne pas
  // perdre l'info (action_taken/trigger_source ne peuvent plus la porter).
  const summary = changesLog.map((c) => c.field).join(', ') || 'canaux/links';
  const { error: actErr } = await supabase.from('bidding_agent_actions').insert({
    strategy_id: id,
    intent: 'manual_adjust',
    trigger_source: 'api',
    agent_response: reason,
    recommendations: {
      summary,
      changes: changesLog,
      pushes: pushes.map((p) => ({ channel: p.channel, status: p.status, detail: p.detail })),
      snapshot_version: snapshotVersion,
    },
    action_taken: 'human_approved',
    applied_at: new Date().toISOString(),
  });
  if (actErr) console.error('[adjust] bidding_agent_actions:', actErr.message);

  return NextResponse.json({ changes: changesLog, snapshot_version: snapshotVersion, pushes });
}
