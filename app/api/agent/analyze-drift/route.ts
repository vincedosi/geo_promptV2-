/**
 * POST /api/agent/analyze-drift
 *
 * Body : { drift_event_id: string, message?: string }
 * Force l'intent `analyze_drift` sur le drift fourni.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { handleAgentRequest } from '@/lib/agent/orchestrator';
import { createLLMRateLimiter, enforceLLMRateLimit } from '@/lib/prompting';

export const dynamic = 'force-dynamic';

const limiter = createLLMRateLimiter({ prefix: 'agent:analyze-drift' });

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const blocked = await enforceLLMRateLimit(limiter, profile.id, request);
  if (blocked) return blocked;

  let body: { drift_event_id?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 });
  }
  if (!body.drift_event_id) {
    return NextResponse.json({ error: 'drift_event_id manquant' }, { status: 400 });
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
