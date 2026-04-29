/**
 * GET  /api/bidding/strategies — liste les stratégies + métadonnées campagne
 * POST /api/bidding/strategies — crée une stratégie depuis le modal "Activer Custom Bidding"
 *
 * Eligibilité POST : la campagne doit exister ET son `dsp_source` doit être ≠ 'adform'.
 * Conflit : interdit si une stratégie en status active existe déjà pour cette campagne.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const VALID_MODES = ['monitor_only', 'suggest', 'auto'] as const;
type ExecutionMode = (typeof VALID_MODES)[number];

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('bidding_strategies')
    .select(`
      id, name, campaign_id, algorithm_code, objective_code,
      execution_mode, scope_type, status, start_date, end_date,
      is_demo, created_at,
      dsp_campaigns!inner ( id, name, dsp_source, is_demo, advertiser )
    `)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ strategies: data ?? [] });
}

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  let body: {
    campaign_id?: string;
    name?: string;
    algorithm_code?: string;
    objective_code?: string;
    execution_mode?: ExecutionMode;
    scope_type?: string;
    is_demo?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 });
  }

  const { campaign_id, name, algorithm_code, objective_code } = body;
  if (!campaign_id || !name || !algorithm_code || !objective_code) {
    return NextResponse.json(
      { error: 'Champs requis : campaign_id, name, algorithm_code, objective_code' },
      { status: 400 },
    );
  }

  const execution_mode: ExecutionMode = body.execution_mode && VALID_MODES.includes(body.execution_mode)
    ? body.execution_mode
    : 'suggest';

  const supabase = createAdminClient();

  // 1. Eligibilité : la campagne existe et n'est pas Adform
  const { data: campaign, error: cErr } = await supabase
    .from('dsp_campaigns')
    .select('id, name, dsp_source, is_demo')
    .eq('id', campaign_id)
    .maybeSingle();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!campaign) return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });
  if ((campaign.dsp_source ?? '').toLowerCase() === 'adform') {
    return NextResponse.json(
      { error: 'Adform campaigns are not eligible for Custom Bidding (DSP source required).' },
      { status: 400 },
    );
  }

  // 2. Conflit : une stratégie active existe déjà ?
  const { data: existing } = await supabase
    .from('bidding_strategies')
    .select('id, name, status')
    .eq('campaign_id', campaign_id)
    .in('status', ['draft', 'active', 'completed'])
    .limit(1);
  if (existing && existing.length > 0) {
    return NextResponse.json(
      { error: `Une stratégie existe déjà sur cette campagne (id=${existing[0].id}).`, existing_id: existing[0].id },
      { status: 409 },
    );
  }

  // 3. INSERT — status='draft' par défaut
  const { data: created, error: iErr } = await supabase
    .from('bidding_strategies')
    .insert({
      name,
      campaign_id,
      algorithm_code,
      objective_code,
      execution_mode,
      scope_type: body.scope_type ?? 'national',
      is_demo: body.is_demo ?? false,
      status: 'draft',
      created_by: profile.id,
    })
    .select('id, name, campaign_id, algorithm_code, objective_code, execution_mode, status, created_at')
    .single();

  if (iErr || !created) {
    return NextResponse.json({ error: iErr?.message ?? 'INSERT failed' }, { status: 500 });
  }
  return NextResponse.json({ strategy: created }, { status: 201 });
}
