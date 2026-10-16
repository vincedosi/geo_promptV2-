/**
 * GET  /api/bidding/strategies — liste les stratégies + métadonnées campagne
 * POST /api/bidding/strategies — crée une stratégie depuis le wizard A4.7 (5 steps)
 *
 * Eligibilité POST : la campagne doit exister ET son `dsp_source` doit être ≠ 'adform'.
 * Conflit : interdit si une stratégie en status active existe déjà pour cette campagne.
 *
 * Étapes du POST :
 *   1. Validation Zod du payload complet (5 steps)
 *   2. Check eligibilité campagne (non-Adform)
 *   3. Check conflit (pas de stratégie active existante)
 *   4. INSERT bidding_strategies avec toutes les colonnes A4.7
 *   5. INSERT batch bidding_strategy_subzones si fourni
 *   5bis. Matérialisation lazy : si in_zone_weights.variable_code est fourni et périmé
 *         (> 30 j / absent de indicator_cp_values), RPC materialize_indicator_cp_values()
 *         avant l'étape suivante — échec → 422 { error: 'indicator_not_ready' }.
 *   6. RPC apply_zone_weights_to_strategy() pour générer les bidding_zone_configs
 *   7. UPDATE draft → consumed si consume_draft_id fourni
 *   8. RPC log_strategy_change(change_type='created')
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkCampaignAccess, checkZoneAccess } from '@/lib/campaigns/access';
import { toJson } from '@/lib/supabase/rpc-json';

export const dynamic = 'force-dynamic';

const SubzoneSchema = z.object({
  name: z.string().min(1).max(200),
  postal_codes: z.array(z.string().min(1)).min(1),
  multiplier: z.number().min(0).max(5),
});

const StrategyCreateSchema = z.object({
  campaign_id: z.string().uuid(),

  // Step 1
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  advertiser: z.string().max(200).optional(),
  brand: z.string().max(200).optional(),
  internal_reference: z.string().max(200).optional(),
  inventory_type: z.enum(['display', 'video', 'dooh', 'ctv', 'audio']).optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),

  // Step 2
  scope_type: z.enum(['national', 'custom_zone']),
  zone_id: z.string().uuid().nullable().optional(),
  weighting_mode: z.enum(['uniform', 'by_tier', 'by_subzone', 'by_cp_csv', 'by_insee_variable']).default('uniform'),
  in_zone_weights: z.record(z.unknown()).default({}),
  out_zone_weights: z.record(z.unknown()).default({}),
  subzones: z.array(SubzoneSchema).optional(),

  // Step 3
  algorithm_code: z.string().min(1),
  objective_code: z.string().min(1),
  kpi_target: z.number().nullable().optional(),
  kpi_secondary: z.array(z.string()).optional(),
  attribution_model: z.enum(['last_click', 'first_click', 'linear']).optional(),

  // Step 4
  total_budget: z.number().nullable().optional(),
  currency: z.string().min(1).max(8).default('EUR'),
  daily_budget_max: z.number().nullable().optional(),
  pacing_strategy: z.enum(['even', 'front_loaded', 'back_loaded', 'custom']).optional(),
  dsp_external_id: z.string().max(200).optional(),
  forecast_cpm: z.number().nullable().optional(),
  frequency_cap_imps: z.number().int().nullable().optional(),
  frequency_cap_period_days: z.number().int().nullable().optional(),

  // Step 5
  execution_mode: z.enum(['monitor_only', 'suggest', 'auto']).default('suggest'),
  init_preset_code: z.string().optional(),
  notification_channels: z.array(z.string()).optional(),
  alert_severity_threshold: z.enum(['low', 'medium', 'high', 'critical']).optional(),

  is_demo: z.boolean().optional(),
  consume_draft_id: z.string().uuid().optional(),
});

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const supabase = createAdminClient();

  const SELECT = `
      id, name, description, campaign_id, algorithm_code, objective_code,
      execution_mode, scope_type, zone_id, status, start_date, end_date,
      advertiser, brand, inventory_type, weighting_mode, init_preset_code,
      total_budget, currency, kpi_target, is_demo, created_at, updated_at,
      dsp_campaigns!inner ( id, name, dsp_source, is_demo, advertiser )
    `;

  // Scope org (IDOR fix — Critique #6) : super_admin voit tout. Sinon,
  // on résout l'ensemble des campaign_id accessibles à l'org active
  // (propriétaire OU liée via campaign_organizations) en 2 requêtes
  // parallèles, puis on filtre les stratégies par cet ensemble en mémoire.
  // Évite un appel checkCampaignAccess par stratégie (borné par la
  // contrainte Nano : max 3 requêtes Supabase parallèles).
  if (profile.role !== 'super_admin') {
    if (!profile.organization_id) {
      return NextResponse.json({ strategies: [] });
    }
    const [ownedRes, linkedRes] = await Promise.all([
      supabase.from('dsp_campaigns').select('id').eq('organization_id', profile.organization_id),
      supabase.from('campaign_organizations').select('campaign_id').eq('organization_id', profile.organization_id),
    ]);
    if (ownedRes.error) return NextResponse.json({ error: ownedRes.error.message }, { status: 500 });
    if (linkedRes.error) return NextResponse.json({ error: linkedRes.error.message }, { status: 500 });

    const accessibleCampaignIds = Array.from(new Set([
      ...(ownedRes.data ?? []).map(r => r.id as string),
      ...(linkedRes.data ?? []).map(r => r.campaign_id as string),
    ]));

    if (accessibleCampaignIds.length === 0) {
      return NextResponse.json({ strategies: [] });
    }

    const { data, error } = await supabase
      .from('bidding_strategies')
      .select(SELECT)
      .in('campaign_id', accessibleCampaignIds)
      .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ strategies: data ?? [] });
  }

  const { data, error } = await supabase
    .from('bidding_strategies')
    .select(SELECT)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ strategies: data ?? [] });
}

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 });
  }

  const parsed = StrategyCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // Check zone consistency
  if (body.scope_type === 'custom_zone' && !body.zone_id) {
    return NextResponse.json({ error: 'zone_id requis pour scope_type=custom_zone' }, { status: 400 });
  }
  if (body.scope_type === 'national' && body.zone_id) {
    return NextResponse.json({ error: 'zone_id interdit pour scope_type=national' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const campaignAccess = await checkCampaignAccess(supabase, profile, body.campaign_id);
  if (campaignAccess !== 'ok') return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });

  // Scope org sur la zone rattachée : empêche de pointer la zone d'une autre org
  // (sondage de géométrie confidentielle + blocage de suppression). Cf. audit sécurité.
  if (body.scope_type === 'custom_zone' && body.zone_id) {
    const zoneAccess = await checkZoneAccess(supabase, profile, body.zone_id);
    if (zoneAccess !== 'ok') return NextResponse.json({ error: 'zone_not_found' }, { status: 404 });
  }

  // 1. Eligibilité : campagne non-Adform
  const { data: campaign, error: cErr } = await supabase
    .from('dsp_campaigns')
    .select('id, name, dsp_source, is_demo')
    .eq('id', body.campaign_id)
    .maybeSingle();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!campaign) return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });
  if ((campaign.dsp_source ?? '').toLowerCase() === 'adform') {
    return NextResponse.json(
      { error: 'Adform campaigns are not eligible for Custom Bidding (DSP source required).' },
      { status: 400 },
    );
  }

  // 2. Conflit : stratégie active existe déjà ?
  const { data: existing } = await supabase
    .from('bidding_strategies')
    .select('id, name, status')
    .eq('campaign_id', body.campaign_id)
    .in('status', ['draft', 'active', 'completed'])
    .limit(1);
  if (existing && existing.length > 0) {
    return NextResponse.json(
      { error: `Une stratégie existe déjà sur cette campagne (id=${existing[0].id}).`, existing_id: existing[0].id },
      { status: 409 },
    );
  }

  // 3. INSERT bidding_strategies
  const insertPayload = {
    name: body.name,
    description: body.description ?? null,
    campaign_id: body.campaign_id,
    algorithm_code: body.algorithm_code,
    objective_code: body.objective_code,
    execution_mode: body.execution_mode,
    scope_type: body.scope_type,
    zone_id: body.zone_id ?? null,
    start_date: body.start_date ?? null,
    end_date: body.end_date ?? null,
    advertiser: body.advertiser ?? null,
    brand: body.brand ?? null,
    internal_reference: body.internal_reference ?? null,
    inventory_type: body.inventory_type ?? null,
    dsp_external_id: body.dsp_external_id ?? null,
    kpi_target: body.kpi_target ?? null,
    kpi_secondary: body.kpi_secondary ?? [],
    attribution_model: body.attribution_model ?? null,
    total_budget: body.total_budget ?? null,
    currency: body.currency,
    daily_budget_max: body.daily_budget_max ?? null,
    pacing_strategy: body.pacing_strategy ?? null,
    forecast_cpm: body.forecast_cpm ?? null,
    frequency_cap_imps: body.frequency_cap_imps ?? null,
    frequency_cap_period_days: body.frequency_cap_period_days ?? null,
    granularity: 'postal_code' as const,
    init_preset_code: body.init_preset_code ?? null,
    weighting_mode: body.weighting_mode,
    in_zone_weights: toJson(body.in_zone_weights),
    out_zone_weights: toJson(body.out_zone_weights),
    notification_channels: body.notification_channels ?? [],
    alert_severity_threshold: body.alert_severity_threshold ?? null,
    is_demo: body.is_demo ?? false,
    status: 'draft' as const,
    status_changed_at: new Date().toISOString(),
    created_by: profile.id,
  };

  const { data: created, error: iErr } = await supabase
    .from('bidding_strategies')
    .insert(insertPayload)
    .select('id, name, campaign_id, scope_type, zone_id, weighting_mode, status, created_at')
    .single();

  if (iErr || !created) {
    return NextResponse.json({ error: iErr?.message ?? 'INSERT failed' }, { status: 500 });
  }

  // 4. INSERT subzones si présent
  if (body.subzones && body.subzones.length > 0) {
    const subzoneRows = body.subzones.map((sz, idx) => ({
      strategy_id: created.id,
      name: sz.name,
      postal_codes: sz.postal_codes,
      multiplier: sz.multiplier,
      display_order: idx,
    }));
    const { error: szErr } = await supabase.from('bidding_strategy_subzones').insert(subzoneRows);
    if (szErr) {
      return NextResponse.json({ error: `subzones: ${szErr.message}` }, { status: 500 });
    }
  }

  // L'indicateur de la courbe doit être matérialisé par CP (frais < 30 j) avant l'application.
  const varCode = (body.in_zone_weights as { variable_code?: string }).variable_code;
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

  // 5. RPC apply_zone_weights_to_strategy
  const { data: nConfigs, error: rpcErr } = await supabase.rpc('apply_zone_weights_to_strategy', {
    p_strategy_id: created.id,
    p_in_weights: toJson(body.in_zone_weights),
    p_out_weights: toJson(body.out_zone_weights),
  });
  if (rpcErr) {
    return NextResponse.json({ error: `apply_zone_weights: ${rpcErr.message}` }, { status: 500 });
  }

  // 6. Consume draft si fourni
  if (body.consume_draft_id) {
    await supabase
      .from('bidding_strategy_drafts')
      .update({ consumed_at: new Date().toISOString(), resulting_strategy_id: created.id })
      .eq('id', body.consume_draft_id)
      .eq('user_id', profile.id);
  }

  // 7. Audit trail : 'created'
  await supabase.rpc('log_strategy_change', {
    p_strategy_id: created.id,
    p_change_type: 'created',
    p_new_value: { name: created.name, weighting_mode: created.weighting_mode, scope_type: created.scope_type },
    p_triggered_by: 'user',
  });

  // Rollups de suivi (cockpit) : in_target/planned_share dépendent du plan
  // qui vient d'être généré — best-effort, jamais bloquant.
  const { error: rollupErr } = await supabase.rpc('refresh_campaign_rollups', {
    p_campaign_id: body.campaign_id,
  });
  if (rollupErr) console.error('[strategies POST] refresh_campaign_rollups:', rollupErr.message);

  return NextResponse.json(
    { strategy: created, n_zone_configs_created: nConfigs ?? 0 },
    { status: 201 },
  );
}
