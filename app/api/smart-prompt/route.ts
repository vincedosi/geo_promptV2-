/**
 * POST /api/smart-prompt
 * Routeur multi-agents GEO.Prompt
 * Reçoit un message utilisateur → route via Mistral → exécute l'agent → retourne SmartPromptResponse
 */

import { NextResponse } from 'next/server';
import { orchestrate }  from '@/lib/smart-prompt/orchestrator';

export const dynamic = 'force-dynamic';

export const maxDuration = 30;

export async function POST(req: Request) {
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
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
