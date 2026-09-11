/**
 * POST /api/smart-prompt
 * Routeur multi-agents GEO.Prompt
 * Reçoit un message utilisateur → route via Mistral → exécute l'agent → retourne SmartPromptResponse
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { lireCorps } from '@/lib/api/valider-corps';
import { orchestrate }  from '@/lib/smart-prompt/orchestrator';
import { createRateLimiter, rateLimitResponse, getClientKey } from '@/lib/api/rate-limit';

export const dynamic = 'force-dynamic';

/** Le message « message requis » est conserve : c'est lui qu'affiche l'UI. */
const SmartPromptSchema = z.object({
  message: z.string().trim().min(1, 'message requis'),
});

export const maxDuration = 30;

const limiter = createRateLimiter({ max: 5, window: '60 s', prefix: 'geo:rl:smart' });

export async function POST(req: Request) {
  const { ok, retrySec } = await limiter(getClientKey(req));
  if (!ok) return rateLimitResponse(retrySec);

  try {
    const corps = await lireCorps(req, SmartPromptSchema);
    if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });

    const response = await orchestrate(corps.valeur.message);
    return NextResponse.json(response);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur interne';
    console.error('[api/smart-prompt]', msg);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
