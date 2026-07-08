/**
 * POST /api/bidding/train
 *
 * Body : { strategy_id: string, days_back?: number (défaut 30) }
 * Appelle le service Modal pour ré-entraîner le modèle.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkStrategyAccess } from '@/lib/campaigns/access';
import { trainModel } from '@/lib/bidding-ml/client';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  let body: { strategy_id?: string; days_back?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 });
  }
  const strategyId = body.strategy_id;
  if (!strategyId) {
    return NextResponse.json({ error: 'strategy_id manquant' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const access = await checkStrategyAccess(supabase, profile, strategyId);
  if (access !== 'ok') return NextResponse.json({ error: 'strategy_not_found' }, { status: 404 });

  try {
    const result = await trainModel(strategyId, body.days_back ?? 30);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
