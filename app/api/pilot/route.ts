import { NextRequest } from 'next/server';
import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from 'ai';
import { requireAdmin } from '@/lib/api/middleware';
import { createModel } from '@/lib/chat/providers';
import { buildPilotTools } from '@/lib/chat/pilot/schemas';
import { buildPilotSystemPrompt, stepCapFor, type PilotMode } from '@/lib/chat/pilot/system-prompt';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const body = await request.json() as { messages: UIMessage[]; mode?: PilotMode };
    const mode: PilotMode = body.mode === 'autonome' ? 'autonome' : 'guide';
    const modelMessages = await convertToModelMessages(body.messages);

    const result = streamText({
      model: createModel('gemini'),
      system: buildPilotSystemPrompt(mode),
      messages: modelMessages,
      stopWhen: stepCountIs(stepCapFor(mode)),
      temperature: 0.1,
      maxRetries: 0,
      tools: buildPilotTools(profile.id),
      providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Erreur inconnue';
    console.error('[pilot]', msg.substring(0, 200));
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
