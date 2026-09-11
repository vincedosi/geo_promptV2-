/**
 * POST /api/agent/chat
 *
 * Body : { message: string, context?: AgentContext }
 * Pipeline complet : détection intent → handler → enforcement → audit trail.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { lireCorps } from '@/lib/api/valider-corps';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { handleAgentRequest } from '@/lib/agent/orchestrator';
import { createLLMRateLimiter, enforceLLMRateLimit } from '@/lib/prompting';

export const dynamic = 'force-dynamic';

/**
 * `context` reprend les quatre clefs d'`AgentContext` (`lib/agent/types.ts`),
 * dont `extra` est volontairement libre. Le defaut `{}` est celui du `?? {}`
 * qu'il remplace.
 */
const ConversationAgentSchema = z.object({
  message: z.string().trim().min(1),
  context: z.object({
    strategy_id: z.string().optional(),
    drift_event_id: z.string().optional(),
    campaign_id: z.string().optional(),
    extra: z.record(z.unknown()).optional(),
  }).default({}),
});

const limiter = createLLMRateLimiter({ prefix: 'agent:chat' });

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const blocked = await enforceLLMRateLimit(limiter, profile.id, request);
  if (blocked) return blocked;

  const corps = await lireCorps(request, ConversationAgentSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });
  const body = corps.valeur;

  try {
    const result = await handleAgentRequest({
      user_id: profile.id,
      message: body.message,
      context: body.context ?? {},
      trigger_source: 'user_chat',
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
