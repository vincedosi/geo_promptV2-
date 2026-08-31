/**
 * POST /api/smart-prompt
 * Routeur multi-agents GEO.Prompt
 * Reçoit un message utilisateur → route via Mistral → exécute l'agent → retourne SmartPromptResponse
 */

import { NextResponse } from 'next/server';
import { orchestrate }  from '@/lib/smart-prompt/orchestrator';
import { createRateLimiter, rateLimitResponse, getClientKey } from '@/lib/api/rate-limit';

export const dynamic = 'force-dynamic';

export const maxDuration = 30;

const limiter = createRateLimiter({ max: 5, window: '60 s', prefix: 'geo:rl:smart' });

export async function POST(req: Request) {
  const { ok, retrySec } = await limiter(getClientKey(req));
  if (!ok) return rateLimitResponse(retrySec);

  try {
    const body = await req.json() as { message?: string };

    if (!body.message || typeof body.message !== 'string' || body.message.trim() === '') {
      return NextResponse.json({ error: 'message requis' }, { status: 400 });
    }

    const response = await orchestrate(body.message.trim());
    return NextResponse.json(response);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur interne';
    console.error('[api/smart-prompt]', msg);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
