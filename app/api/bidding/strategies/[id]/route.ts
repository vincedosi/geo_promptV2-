/**
 * GET    /api/bidding/strategies/[id]
 *   → détails complets stratégie + campagne + objective + active model + subzones
 *
 * PATCH  /api/bidding/strategies/[id]
 *   → édition champ-par-champ avec audit trail dans strategy_changes.
 *     Si weighting_mode/in_zone_weights/out_zone_weights changent → relance
 *     apply_zone_weights_to_strategy() et regénère bidding_zone_configs.
 *     Avant cette RPC : matérialisation lazy de l'indicateur de la courbe
 *     (in_zone_weights.variable_code) si périmé (> 30 j) via RPC
 *     materialize_indicator_cp_values() — échec → 422 { error: 'indicator_not_ready' }.
 *
 * DELETE /api/bidding/strategies/[id]
 *   → soft-archive : status='archived' + status_changed_at + audit log.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkStrategyAccess, checkZoneAccess } from '@/lib/campaigns/access';
import { toJson } from '@/lib/supabase/rpc-json';

export const dynamic = 'force-dynamic';

const SubzoneSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  postal_codes: z.array(z.string().min(1)).min(1),
  multiplier: z.number().min(0).max(5),
});

const StrategyPatchSchema = z.object({
  // Partial — tous les champs optionnels
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  advertiser: z.string().max(200).nullable().optional(),
  brand: z.string().max(200).nullable().optional(),
  internal_reference: z.string().max(200).nullable().optional(),
  inventory_type: z.enum(['display', 'video', 'dooh', 'ctv', 'audio']).nullable().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  scope_type: z.enum(['national', 'custom_zone']).optional(),
  zone_id: z.string().uuid().nullable().optional(),
  weighting_mode: z.enum(['uniform', 'by_tier', 'by_subzone', 'by_cp_csv', 'by_insee_variable']).optional(),
  in_zone_weights: z.record(z.unknown()).optional(),
  out_zone_weights: z.record(z.unknown()).optional(),
  subzones: z.array(SubzoneSchema).optional(),
  algorithm_code: z.string().min(1).optional(),
  objective_code: z.string().min(1).optional(),
  kpi_target: z.number().nullable().optional(),
  kpi_secondary: z.array(z.string()).optional(),
  attribution_model: z.enum(['last_click', 'first_click', 'linear']).nullable().optional(),
  total_budget: z.number().nullable().optional(),
  currency: z.string().min(1).max(8).optional(),
  daily_budget_max: z.number().nullable().optional(),
  pacing_strategy: z.enum(['even', 'front_loaded', 'back_loaded', 'custom']).nullable().optional(),
  dsp_external_id: z.string().max(200).nullable().optional(),
  forecast_cpm: z.number().nullable().optional(),
  frequency_cap_imps: z.number().int().nullable().optional(),
  frequency_cap_period_days: z.number().int().nullable().optional(),
  execution_mode: z.enum(['monitor_only', 'suggest', 'auto']).optional(),
  init_preset_code: z.string().nullable().optional(),
  notification_channels: z.array(z.string()).optional(),
  alert_severity_threshold: z.enum(['low', 'medium', 'high', 'critical']).nullable().optional(),
  status: z.enum(['draft', 'active', 'paused', 'completed', 'archived']).optional(),
  reason: z.string().max(2000).optional(),
});

type StrategyPatch = z.infer<typeof StrategyPatchSchema>;

const FULL_SELECT = `
  id, name, description, campaign_id, algorithm_code, objective_code,
  config, scope_type, zone_id, start_date, end_date, status, activated_at,
  is_demo, created_by, created_at, updated_at, execution_mode,
  advertiser, brand, internal_reference, inventory_type, dsp_external_id,
  kpi_target, kpi_secondary, attribution_model, total_budget, currency,
  daily_budget_max, pacing_strategy, forecast_cpm, frequency_cap_imps,
  frequency_cap_period_days, granularity, init_preset_code, weighting_mode,
  in_zone_weights, out_zone_weights, notification_channels,
  alert_severity_threshold, status_changed_at
`;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { id } = await params;
  const supabase = createAdminClient();

  const access = await checkStrategyAccess(supabase, profile, id);
  if (access !== 'ok') return NextResponse.json({ error: 'strategy_not_found' }, { status: 404 });

  const { data: strategy, error: sErr } = await supabase
    .from('bidding_strategies')
    .select(FULL_SELECT)
    .eq('id', id)
    .single();

  if (sErr || !strategy) {
    return NextResponse.json({ error: 'Stratégie introuvable' }, { status: 404 });
  }

  // ⛔ Nano : max 3 appels Supabase simultanes (CLAUDE.md). Ces 5 lectures sont
  // unitaires et indexees, mais la limite est absolue -> deux lots de 3 puis 2.
  const [campaignResp, objectiveResp, activeModelResp] = await Promise.all([
    supabase
      .from('dsp_campaigns')
      .select('id,name,dsp_source,advertiser,date_start,date_end,is_demo,total_tracked_ads,total_unique_impressions')
      .eq('id', strategy.campaign_id)
      .maybeSingle(),
    supabase
      .from('bidding_objectives')
      .select('code,optimization_direction,formula,required_metrics,display_name,display_name_fr')
      .eq('code', strategy.objective_code)
      .maybeSingle(),
    supabase
      .from('adaptive_model_state')
      .select('id,algorithm_code,model_version,training_window_start,training_window_end,performance_metrics,trained_at,promoted_at')
      .eq('strategy_id', id)
      .eq('is_active', true)
      .maybeSingle(),
  ]);

  const [subzonesResp, autonomyResp] = await Promise.all([
    supabase
      .from('bidding_strategy_subzones')
      .select('id, name, postal_codes, multiplier, display_order')
      .eq('strategy_id', id)
      .order('display_order'),
    supabase
      .from('agent_autonomy_settings')
      .select('autonomy_level')
      .eq('scope_type', 'strategy')
      .eq('strategy_id', id)
      .maybeSingle(),
  ]);

  return NextResponse.json({
    strategy,
    campaign: campaignResp.data ?? null,
    objective: objectiveResp.data ?? null,
    active_model: activeModelResp.data ?? null,
    subzones: subzonesResp.data ?? [],
    agent_autonomy_override: autonomyResp.data?.autonomy_level ?? null,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { id } = await params;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 });
  }
  const parsed = StrategyPatchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;
  const reason = body.reason;

  const supabase = createAdminClient();

  const access = await checkStrategyAccess(supabase, profile, id);
  if (access !== 'ok') return NextResponse.json({ error: 'strategy_not_found' }, { status: 404 });

  // Charger l'état actuel pour comparer
  const { data: current, error: cErr } = await supabase
    .from('bidding_strategies')
    .select(FULL_SELECT)
    .eq('id', id)
    .single();
  if (cErr || !current) {
    return NextResponse.json({ error: 'Stratégie introuvable' }, { status: 404 });
  }

  type StrategyRow = Record<string, unknown>;
  const cur = current as unknown as StrategyRow;

  // Construire le patch + détecter les champs modifiés
  const updates: Record<string, unknown> = {};
  const changes: Array<{ field: string; old: unknown; new: unknown }> = [];

  const PATCH_KEYS: Array<keyof StrategyPatch> = [
    'name', 'description', 'advertiser', 'brand', 'internal_reference', 'inventory_type',
    'start_date', 'end_date', 'scope_type', 'zone_id', 'weighting_mode',
    'in_zone_weights', 'out_zone_weights', 'algorithm_code', 'objective_code',
    'kpi_target', 'kpi_secondary', 'attribution_model', 'total_budget', 'currency',
    'daily_budget_max', 'pacing_strategy', 'dsp_external_id', 'forecast_cpm',
    'frequency_cap_imps', 'frequency_cap_period_days', 'execution_mode',
    'init_preset_code', 'notification_channels', 'alert_severity_threshold', 'status',
  ];

  for (const key of PATCH_KEYS) {
    const v = body[key];
    if (v === undefined) continue;
    const before = cur[key as string];
    if (JSON.stringify(before) !== JSON.stringify(v)) {
      updates[key as string] = v;
      changes.push({ field: key as string, old: before, new: v });
    }
  }

  // Si status change → status_changed_at
  if (body.status !== undefined && body.status !== cur.status) {
    updates.status_changed_at = new Date().toISOString();
  }

  // Scope org sur une zone (ré)assignée : interdit de pointer la zone d'une
  // autre org via un PATCH (contournement de checkZoneAccess). Cf. audit sécurité.
  if ('zone_id' in updates && updates.zone_id) {
    const zoneAccess = await checkZoneAccess(supabase, profile, updates.zone_id as string);
    if (zoneAccess !== 'ok') return NextResponse.json({ error: 'zone_not_found' }, { status: 404 });
  }

  if (Object.keys(updates).length === 0 && !body.subzones) {
    return NextResponse.json({ strategy: current, changes: [] });
  }

  // UPDATE bidding_strategies
  if (Object.keys(updates).length > 0) {
    const { error: uErr } = await supabase
      .from('bidding_strategies')
      .update(updates)
      .eq('id', id);
    if (uErr) {
      return NextResponse.json({ error: uErr.message }, { status: 500 });
    }
  }

  // UPDATE subzones (replace all si fourni)
  if (body.subzones) {
    const oldSubzonesResp = await supabase
      .from('bidding_strategy_subzones')
      .select('id, name, postal_codes, multiplier')
      .eq('strategy_id', id);

    await supabase.from('bidding_strategy_subzones').delete().eq('strategy_id', id);
    if (body.subzones.length > 0) {
      const rows = body.subzones.map((sz, idx) => ({
        strategy_id: id,
        name: sz.name,
        postal_codes: sz.postal_codes,
        multiplier: sz.multiplier,
        display_order: idx,
      }));
      const { error: ssErr } = await supabase.from('bidding_strategy_subzones').insert(rows);
      if (ssErr) return NextResponse.json({ error: ssErr.message }, { status: 500 });
    }
    changes.push({ field: 'subzones', old: oldSubzonesResp.data ?? [], new: body.subzones });
  }

  // Si pondération a changé → relancer apply_zone_weights_to_strategy
  const weightChanged =
    'weighting_mode' in updates ||
    'in_zone_weights' in updates ||
    'out_zone_weights' in updates ||
    'zone_id' in updates ||
    'scope_type' in updates ||
    body.subzones !== undefined;

  if (weightChanged) {
    const newInWeights = (updates.in_zone_weights as Record<string, unknown>) ?? cur.in_zone_weights ?? {};
    const newOutWeights = (updates.out_zone_weights as Record<string, unknown>) ?? cur.out_zone_weights ?? {};

    // L'indicateur de la courbe doit être matérialisé par CP (frais < 30 j) avant l'application.
    const varCode = (newInWeights as { variable_code?: string }).variable_code;
    if (varCode) {
      const { data: fresh } = await supabase
        .from('indicator_cp_values')
        .select('computed_at')
        .eq('indicator_code', varCode)
        .limit(1)
        .maybeSingle();
      const stale = !fresh || Date.now() - new Date(fresh.computed_at).getTime() > 30 * 24 * 3600 * 1000;
      if (stale) {
        const { error: matErr } = await supabase.rpc('materialize_indicator_cp_values', { p_indicator_code: varCode });
        if (matErr) {
          return NextResponse.json({ error: 'indicator_not_ready', detail: matErr.message }, { status: 422 });
        }
      }
    }

    const { error: rpcErr } = await supabase.rpc('apply_zone_weights_to_strategy', {
      p_strategy_id: id,
      p_in_weights: toJson(newInWeights),
      p_out_weights: toJson(newOutWeights),
    });
    if (rpcErr) {
      return NextResponse.json({ error: `apply_zone_weights: ${rpcErr.message}` }, { status: 500 });
    }
  }

  // Rollups de suivi (cockpit) : le plan (in_target/planned_share) ou
  // l'activation ont pu changer — best-effort, jamais bloquant.
  if (weightChanged || ('status' in updates && updates.status === 'active')) {
    const { error: rollupErr } = await supabase.rpc('refresh_campaign_rollups', {
      p_campaign_id: current.campaign_id,
    });
    if (rollupErr) console.error('[strategies PATCH] refresh_campaign_rollups:', rollupErr.message);
  }

  // Audit : 1 row par champ modifié
  for (const ch of changes) {
    const changeType = (() => {
      if (ch.field === 'subzones') return 'subzones_modified';
      if (ch.field === 'weighting_mode' || ch.field === 'in_zone_weights' || ch.field === 'out_zone_weights') {
        return 'weighting_updated';
      }
      if (ch.field === 'scope_type' || ch.field === 'zone_id') return 'scope_changed';
      if (ch.field === 'status') {
        if (ch.new === 'paused') return 'paused';
        if (ch.new === 'archived') return 'archived';
        if (ch.old === 'paused' && ch.new === 'active') return 'resumed';
        if (ch.old === 'archived' && ch.new === 'active') return 'reactivated';
        return 'config_updated';
      }
      return 'config_updated';
    })();

    await supabase.rpc('log_strategy_change', {
      p_strategy_id: id,
      p_change_type: changeType,
      p_field_path: ch.field,
      p_old_value: ch.old as never,
      p_new_value: ch.new as never,
      p_reason: reason ?? undefined,
      p_triggered_by: 'user',
    });
  }

  // Re-load
  const { data: refreshed } = await supabase
    .from('bidding_strategies')
    .select(FULL_SELECT)
    .eq('id', id)
    .single();

  return NextResponse.json({ strategy: refreshed, changes });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { id } = await params;
  const supabase = createAdminClient();

  const access = await checkStrategyAccess(supabase, profile, id);
  if (access !== 'ok') return NextResponse.json({ error: 'strategy_not_found' }, { status: 404 });

  const { data: current } = await supabase
    .from('bidding_strategies')
    .select('status')
    .eq('id', id)
    .maybeSingle();

  if (!current) {
    return NextResponse.json({ error: 'Stratégie introuvable' }, { status: 404 });
  }

  const { error: uErr } = await supabase
    .from('bidding_strategies')
    .update({ status: 'archived', status_changed_at: new Date().toISOString() })
    .eq('id', id);
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  await supabase.rpc('log_strategy_change', {
    p_strategy_id: id,
    p_change_type: 'archived',
    p_field_path: 'status',
    p_old_value: { status: current.status } as never,
    p_new_value: { status: 'archived' } as never,
    p_triggered_by: 'user',
  });

  return NextResponse.json({ archived: true, id });
}
