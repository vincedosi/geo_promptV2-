/**
 * POST /api/agent/chat
 *
 * Body : { message: string, context?: AgentContext }
 * Pipeline complet : détection intent → handler → enforcement → audit trail.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { handleAgentRequest } from '@/lib/agent/orchestrator';
import { createLLMRateLimiter, enforceLLMRateLimit } from '@/lib/prompting';
import type { AgentContext } from '@/lib/agent/types';

export const dynamic = 'force-dynamic';

const limiter = createLLMRateLimiter({ prefix: 'agent:chat' });

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const blocked = await enforceLLMRateLimit(limiter, profile.id, request);
  if (blocked) return blocked;

  let body: { message?: string; context?: AgentContext };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 });
  }
  if (!body.message?.trim()) {
    return NextResponse.json({ error: 'message manquant' }, { status: 400 });
  }

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
