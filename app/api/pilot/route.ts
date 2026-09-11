import { NextRequest } from 'next/server';
import { z } from 'zod';
import { lireCorps } from '@/lib/api/valider-corps';
import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from 'ai';
import { requireAdmin } from '@/lib/api/middleware';
import { createModel } from '@/lib/chat/providers';
import { buildPilotTools } from '@/lib/chat/pilot/schemas';
import { buildPilotSystemPrompt, stepCapFor, type PilotMode } from '@/lib/chat/pilot/system-prompt';

export const dynamic = 'force-dynamic';

/**
 * `messages` est une union du SDK Vercel AI (`UIMessage`) : la modeliser
 * reviendrait a figer les details internes du SDK dans notre code, et a casser
 * la conversation a chaque montee de version. On garantit donc seulement le
 * TABLEAU NON VIDE — ce qui suffit : `convertToModelMessages(undefined)` levait,
 * et la route repondait 500 pour un corps vide.
 *
 * `mode` etait lu par `body.mode === 'autonome' ? 'autonome' : 'guide'` : toute
 * autre valeur retombait en silence sur « guide ». Un mode mal orthographie
 * donne maintenant un 400, au lieu d'un pilotage guide qu'on croyait autonome.
 */
const PiloteSchema = z.object({
  messages: z.array(z.unknown()).nonempty(),
  mode: z.enum(['guide', 'autonome']).optional(),
});
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const corps = await lireCorps(request, PiloteSchema);
    if (!corps.ok) {
      return new Response(JSON.stringify({ error: corps.message }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    // `messages` reste traverse tel quel : `UIMessage` est une union du SDK
    // Vercel AI qu'un schema ne peut pas modeliser sans en figer les details
    // internes. Ce qui est verifie ici, c'est qu'il y a bien un TABLEAU NON VIDE
    // — sans quoi `convertToModelMessages` levait, et la route repondait 500.
    const messages = corps.valeur.messages as UIMessage[];
    const mode: PilotMode = corps.valeur.mode ?? 'guide';
    const modelMessages = await convertToModelMessages(messages);

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
