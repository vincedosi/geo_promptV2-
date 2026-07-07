/**
 * POST /api/digital/[campaignId]/campaign-chat
 * Chat IA « Suivi campagne » : interroge ce qu'il s'est passé dans la campagne.
 * Historique ÉPHÉMÈRE (renvoyé par le client dans le body) — aucun stockage.
 * Contexte injecté dans le system prompt (pattern /api/bidding/strategies/[id]/chat) :
 * stats géo agrégées, journal de la stratégie si elle existe, croisement IRIS borné.
 * Budget I/O Nano : uniquement des RPC/agrégats bornés, max 3 requêtes en parallèle.
 */
import { NextRequest, NextResponse } from 'next/server';
import { streamText } from 'ai';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { createModel } from '@/lib/chat/providers';
import {
  CampaignChatBodySchema, truncateHistory, buildSuiviChatSystemPrompt,
  type StatRow, type JournalLine, type StrategyMeta,
} from '@/lib/campaigns/suivi-chat';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function toStatRows(rows: unknown, labelKeys: string[]): StatRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((raw) => {
    const r = raw as Record<string, unknown>;
    const label = labelKeys.map((k) => r[k]).find((v) => typeof v === 'string' && v.length > 0);
    return {
      label: (label as string | undefined) ?? '(vide)',
      tracked_ads: Number(r.tracked_ads ?? 0),
      row_count: Number(r.row_count ?? 0),
    };
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { campaignId } = await params;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(campaignId)) {
    return NextResponse.json({ error: 'invalid_campaign_id' }, { status: 400 });
  }

  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const parsed = CampaignChatBodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { message } = parsed.data;
  const history = truncateHistory(parsed.data.history);

  const supabase = createAdminClient();

  const { data: campaign, error: campaignError } = await supabase
    .from('dsp_campaigns')
    .select('id, name, dsp_source, date_start, date_end, total_tracked_ads, countries, status_override')
    .eq('id', campaignId)
    .single();
  if (campaignError) console.error('[campaign-chat] campaign:', campaignError.message);
  if (!campaign) return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });

  // Stats géo agrégées (RPC existantes) — 2 appels en parallèle (< 3, contrainte Nano).
  const [countryRes, regionRes] = await Promise.all([
    supabase.rpc('get_campaign_stats_by_field', { p_campaign_id: campaignId, p_field: 'country' }),
    supabase.rpc('get_campaign_stats_by_field', { p_campaign_id: campaignId, p_field: 'region' }),
  ]);
  if (countryRes.error) console.error('[campaign-chat] stats country:', countryRes.error.message);
  if (regionRes.error) console.error('[campaign-chat] stats region:', regionRes.error.message);
  const parseJsonbRows = (d: unknown): unknown =>
    typeof d === 'string' ? JSON.parse(d) : (d ?? []);
  const byCountry = toStatRows(parseJsonbRows(countryRes.data), ['country', 'field_value']);
  const byRegion = toStatRows(parseJsonbRows(regionRes.data), ['region', 'field_value']);

  // Croisement IRIS : une seule RPC déjà bornée (30 départements max), pas de boucle cp-detail.
  const metricField = campaign.dsp_source === 'adform' ? 'tracked_ads' : 'impressions';
  const { data: breakdownRaw, error: breakdownError } = await supabase.rpc('get_digital_analysis_breakdown_v2', {
    p_campaign_id: campaignId,
    p_aggregation: 'dept',
    p_indicator: 'population',
    p_media: null,
    p_limit: 30,
    p_pop_min: 0,
    p_metric_field: metricField,
    p_parent_type: null,
    p_parent_code: null,
  });
  if (breakdownError) console.error('[campaign-chat] breakdown:', breakdownError.message);
  const breakdownDept = (
    typeof breakdownRaw === 'string' ? JSON.parse(breakdownRaw) : (breakdownRaw ?? [])
  ) as Array<Record<string, unknown>>;

  // Stratégie de bidding rattachée (facultative) + journal borné.
  const { data: strategyRow, error: strategyError } = await supabase
    .from('bidding_strategies')
    .select('id, name, status, algorithm_code, objective_code, execution_mode, total_budget, forecast_cpm, start_date, end_date')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (strategyError) console.error('[campaign-chat] strategy:', strategyError.message);

  let strategy: StrategyMeta | null = null;
  const journal: JournalLine[] = [];
  if (strategyRow) {
    strategy = {
      name: strategyRow.name,
      status: strategyRow.status,
      algorithm_code: strategyRow.algorithm_code,
      objective_code: strategyRow.objective_code,
      execution_mode: strategyRow.execution_mode,
      total_budget: strategyRow.total_budget,
      forecast_cpm: strategyRow.forecast_cpm,
      start_date: strategyRow.start_date ? String(strategyRow.start_date).slice(0, 10) : null,
      end_date: strategyRow.end_date ? String(strategyRow.end_date).slice(0, 10) : null,
    };
    // 3 requêtes bornées en parallèle (= max Nano), mêmes tables que la route journal.
    const [actionsRes, driftsRes, recosRes] = await Promise.all([
      supabase.from('bidding_agent_actions')
        .select('intent, agent_response, applied_at, created_at')
        .eq('strategy_id', strategyRow.id)
        .order('created_at', { ascending: false })
        .limit(25),
      supabase.from('bidding_drift_events')
        .select('postal_code, drift_type, description, detected_at')
        .eq('strategy_id', strategyRow.id)
        .order('detected_at', { ascending: false })
        .limit(15),
      supabase.from('agent_recommendations')
        .select('title, body, generated_at')
        .eq('strategy_id', strategyRow.id)
        .order('generated_at', { ascending: false })
        .limit(10),
    ]);
    if (actionsRes.error) console.error('[campaign-chat] actions:', actionsRes.error.message);
    if (driftsRes.error) console.error('[campaign-chat] drifts:', driftsRes.error.message);
    if (recosRes.error) console.error('[campaign-chat] recos:', recosRes.error.message);
    for (const a of (actionsRes.data ?? []) as Array<{ intent: string; agent_response: string | null; applied_at: string | null; created_at: string }>) {
      journal.push({ at: a.applied_at ?? a.created_at, kind: 'action', title: a.intent, body: a.agent_response ?? '' });
    }
    for (const d of (driftsRes.data ?? []) as Array<{ postal_code: string; drift_type: string; description: string; detected_at: string }>) {
      journal.push({ at: d.detected_at, kind: 'drift', title: `Drift ${d.drift_type} · CP ${d.postal_code}`, body: d.description });
    }
    for (const r of (recosRes.data ?? []) as Array<{ title: string; body: string; generated_at: string }>) {
      journal.push({ at: r.generated_at, kind: 'recommendation', title: r.title, body: r.body });
    }
    journal.sort((a, b) => a.at.localeCompare(b.at));
  }

  const systemPrompt = buildSuiviChatSystemPrompt({
    campaign: {
      name: campaign.name,
      dsp_source: campaign.dsp_source,
      date_start: campaign.date_start,
      date_end: campaign.date_end,
      total_tracked_ads: campaign.total_tracked_ads ?? 0,
      countries: campaign.countries,
      status_override: campaign.status_override,
    },
    byCountry,
    byRegion,
    breakdownDept,
    strategy,
    journal,
  });

  try {
    const result = streamText({
      model: createModel('gemini'),
      system: systemPrompt,
      messages: [...history, { role: 'user' as const, content: message }],
      temperature: 0.3,
    });
    return result.toTextStreamResponse();
  } catch (e) {
    console.error('[campaign-chat]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'llm_error' }, { status: 500 });
  }
}
