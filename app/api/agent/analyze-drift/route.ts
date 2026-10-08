/**
 * POST /api/agent/analyze-drift
 *
 * Body : { drift_event_id: string, message?: string }
 * Force l'intent `analyze_drift` sur le drift fourni.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { lireCorps } from '@/lib/api/valider-corps';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { verifierContexteAgent } from '@/lib/agent/acces-contexte';
import { handleAgentRequest } from '@/lib/agent/orchestrator';
import { createLLMRateLimiter, enforceLLMRateLimit } from '@/lib/prompting';

export const dynamic = 'force-dynamic';

/**
 * `message` est optionnel et vaut la chaine vide par defaut — c'est le `?? ''`
 * du code d'origine. `drift_event_id` n'est pas contraint a un UUID : il est
 * passe en contexte a l'agent, qui decide quoi en faire.
 */
const AnalyserDeriveSchema = z.object({
  drift_event_id: z.string().min(1),
  message: z.string().default(''),
});

const limiter = createLLMRateLimiter({ prefix: 'agent:analyze-drift' });

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const blocked = await enforceLLMRateLimit(limiter, profile.id, request);
  if (blocked) return blocked;

  const corps = await lireCorps(request, AnalyserDeriveSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });
  const body = corps.valeur;

  // `drift_event_id` vient du navigateur : la dérive doit appartenir à une
  // stratégie de l'organisation de l'appelant.
  const acces = await verifierContexteAgent(createAdminClient(), profile, { drift_event_id: body.drift_event_id });
  if (acces !== 'ok') {
    return NextResponse.json({ error: acces }, { status: acces === 'not_found' ? 404 : 403 });
  }

  try {
    const result = await handleAgentRequest({
      user_id: profile.id,
      message: body.message ?? '',
      context: { drift_event_id: body.drift_event_id },
      trigger_source: 'user_chat',
      forced_intent: 'analyze_drift',
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
