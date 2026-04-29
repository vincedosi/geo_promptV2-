/**
 * POST /api/bidding/predict
 *
 * Body : { strategy_id: string, days?: number }
 * Appelle le service Modal en HTTPS, persiste selon execution_mode.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { predictForStrategy } from '@/lib/bidding-ml/client';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  let body: { strategy_id?: string; days?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 });
  }

  const strategyId = body.strategy_id;
  if (!strategyId) {
    return NextResponse.json({ error: 'strategy_id manquant' }, { status: 400 });
  }

  try {
    const result = await predictForStrategy(strategyId, body.days);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
