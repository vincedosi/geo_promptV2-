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
import { z } from 'zod';
import { lireCorps } from '@/lib/api/valider-corps';

export const dynamic = 'force-dynamic';

/**
 * `days_back` partait vers Modal sans controle : une chaine y arrivait telle
 * quelle. La valeur par defaut de 30 est celle du `?? 30` qu'elle remplace.
 */
const EntrainerSchema = z.object({
  strategy_id: z.string().uuid(),
  days_back: z.number().int().positive().max(365).default(30),
});

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const corps = await lireCorps(request, EntrainerSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });
  const body = corps.valeur;
  const strategyId = body.strategy_id;

  const supabase = createAdminClient();
  const access = await checkStrategyAccess(supabase, profile, strategyId);
  if (access !== 'ok') return NextResponse.json({ error: 'strategy_not_found' }, { status: 404 });

  try {
    const result = await trainModel(strategyId, body.days_back);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
