/**
 * GET   /api/bidding/strategies/[id] — détails stratégie + campagne + objective + active model
 * PATCH /api/bidding/strategies/[id] — { execution_mode } pour basculer auto/suggest/monitor_only
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

type ExecutionMode = 'monitor_only' | 'suggest' | 'auto';
const VALID_MODES: ExecutionMode[] = ['monitor_only', 'suggest', 'auto'];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { id } = await params;
  const supabase = createAdminClient();

  const { data: strategy, error: sErr } = await supabase
    .from('bidding_strategies')
    .select(
      'id,name,description,campaign_id,algorithm_code,objective_code,execution_mode,config,scope_type,start_date,end_date,status,is_demo,created_at,updated_at',
    )
    .eq('id', id)
    .single();

  if (sErr || !strategy) {
    return NextResponse.json({ error: 'Stratégie introuvable' }, { status: 404 });
  }

  const [campaignResp, objectiveResp, activeModelResp] = await Promise.all([
    supabase
      .from('dsp_campaigns')
      .select('id,name,dsp_source,advertiser,date_start,date_end,is_demo,total_tracked_ads,total_unique_impressions')
      .eq('id', strategy.campaign_id)
      .single(),
    supabase
      .from('bidding_objectives')
      .select('code,optimization_direction,formula,required_metrics,display_name')
      .eq('code', strategy.objective_code)
      .maybeSingle(),
    supabase
      .from('adaptive_model_state')
      .select('id,algorithm_code,model_version,training_window_start,training_window_end,performance_metrics,trained_at,promoted_at')
      .eq('strategy_id', id)
      .eq('is_active', true)
      .maybeSingle(),
  ]);

  return NextResponse.json({
    strategy,
    campaign: campaignResp.data ?? null,
    objective: objectiveResp.data ?? null,
    active_model: activeModelResp.data ?? null,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  if (profile.role !== 'admin' && profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'admin requis' }, { status: 403 });
  }

  const { id } = await params;
  let body: { execution_mode?: ExecutionMode };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 });
  }
  if (!body.execution_mode || !VALID_MODES.includes(body.execution_mode)) {
    return NextResponse.json(
      { error: `execution_mode invalide. Attendu: ${VALID_MODES.join('|')}` },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('bidding_strategies')
    .update({ execution_mode: body.execution_mode })
    .eq('id', id)
    .select('id,execution_mode')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'UPDATE failed' }, { status: 500 });
  }
  return NextResponse.json(data);
}
