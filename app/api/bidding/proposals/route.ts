/**
 * GET  /api/bidding/proposals?strategy_id=<id>&status=pending
 * POST /api/bidding/proposals  (création manuelle, debug — non utilisée par le flow normal)
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkStrategyAccess } from '@/lib/campaigns/access';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { searchParams } = new URL(request.url);
  const strategyId = searchParams.get('strategy_id');
  const status = searchParams.get('status') ?? 'pending';
  if (!strategyId) {
    return NextResponse.json({ error: 'strategy_id manquant' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const access = await checkStrategyAccess(supabase, profile, strategyId);
  if (access !== 'ok') return NextResponse.json({ error: 'strategy_not_found' }, { status: 404 });

  const { data, error } = await supabase
    .from('bidding_zone_config_proposals')
    .select(
      'id,strategy_id,postal_code,country_code,proposed_bid_multiplier,reasoning,status,proposed_by,proposed_at,expires_at,reviewed_at,review_notes',
    )
    .eq('strategy_id', strategyId)
    .eq('status', status)
    .order('proposed_at', { ascending: false })
    .limit(500);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ proposals: data ?? [] });
}

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  if (profile.role !== 'admin' && profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'admin requis' }, { status: 403 });
  }

  let body: {
    strategy_id?: string;
    postal_code?: string;
    country_code?: string;
    proposed_bid_multiplier?: number;
    reasoning?: Record<string, unknown>;
    proposed_by?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 });
  }
  if (!body.strategy_id || !body.postal_code || body.proposed_bid_multiplier == null) {
    return NextResponse.json({ error: 'Champs requis : strategy_id, postal_code, proposed_bid_multiplier' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const access = await checkStrategyAccess(supabase, profile, body.strategy_id);
  if (access !== 'ok') return NextResponse.json({ error: 'strategy_not_found' }, { status: 404 });

  const { data, error } = await supabase
    .from('bidding_zone_config_proposals')
    .insert({
      strategy_id: body.strategy_id,
      postal_code: body.postal_code,
      country_code: body.country_code ?? 'FR',
      proposed_bid_multiplier: body.proposed_bid_multiplier,
      reasoning: body.reasoning ?? {},
      proposed_by: body.proposed_by ?? 'manual',
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ id: data.id }, { status: 201 });
}
