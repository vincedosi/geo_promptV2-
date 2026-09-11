import { NextRequest } from 'next/server';
import { z } from 'zod';
import { lireCorps } from '@/lib/api/valider-corps';
import { logger } from '@/lib/logger';
import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from 'ai';
import { getDistinctCategories } from '@/lib/poi/categories';
import { hasDatagouvKeywords, loadDatagouvTools, DATAGOUV_SYSTEM_ADDENDUM } from '@/lib/mcp/datagouv';
import { createModel, getMaxRetries, type Provider } from '@/lib/chat/providers';
import { buildSystemPrompt } from '@/lib/chat/system-prompt';
import { buildTools } from '@/lib/chat/tools';
import { trimHistory } from '@/lib/chat/trim-history';
import { getSessionOrg } from '@/lib/auth/getSessionOrg';
import { getOrgSourceIds } from '@/lib/auth/getOrgSourceIds';
import { orgContextStorage } from '@/lib/chat/tools/orgContext';
import { createRateLimiter, getClientKey } from '@/lib/api/rate-limit';

// Timeout étendu pour les retries ORS (rate limit 20s × max 3 × N batches)
export const maxDuration = 120;

// ── Quotas d'appels : moteur partage, voir lib/api/rate-limit.ts ─────────────
// Pour activer Upstash : ajouter UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN dans .env.local
// Sans ces vars → fallback in-memory (fonctionne en dev, pas sur Vercel multi-instance)

export const dynamic = 'force-dynamic';

/**
 * Corps du copilote.
 *
 * `messages` est une union du SDK Vercel AI (`UIMessage`). La modeliser
 * figerait les details internes du SDK dans notre code — le fichier porte deja
 * un `@ts-expect-error` qui le dit. On garantit donc le TABLEAU NON VIDE, rien
 * de plus : c'est ce qui manquait, un corps sans `messages` faisant lever
 * `extractLastUserText` puis repondre 500.
 *
 * `provider` vient du type `Provider` de `lib/chat/providers.ts` : les deux
 * seules valeurs que `createModel` sait instancier. Avant, un provider inconnu
 * arrivait jusqu'a `createModel`.
 */
const ConversationSchema = z.object({
  messages: z.array(z.unknown()).nonempty(),
  forceRecalculate: z.boolean().default(false),
  provider: z.enum(['mistral', 'gemini'] as const satisfies readonly Provider[]).default('gemini'),
});

// Deux quotas se cumulent ici : par IP, et par compte authentifie — le second
// protege le cout LLM quand un meme compte multiplie les requetes derriere des
// IP differentes (proxy, mobile).
//
// Cette route portait sa PROPRE copie de la logique de quota (Upstash + une Map
// locale), troisieme exemplaire dans le projet. Elle passe par `lib/api/rate-limit`
// comme les autres : un seul endroit ou le moteur partage est choisi (`ECH-004`).
const chatIpLimiter   = createRateLimiter({ max: 12, window: '60 s', prefix: 'geo:rl' });
const chatUserLimiter = createRateLimiter({ max: 10, window: '60 s', prefix: 'geo:rl:chat-user' });

const checkRateLimit = chatIpLimiter;

// ── Extraction du texte du dernier message utilisateur ────────────────────────
function extractLastUserText(messages: UIMessage[]): string {
  const last = [...messages].reverse().find(m => m.role === 'user');
  if (!last) return '';
  // AI SDK v6 useChat envoie parts[] — chaque part {type:'text', text:string}
  if (Array.isArray(last.parts) && last.parts.length > 0) {
    return last.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map(p => p.text)
      .join(' ');
  }
  // UIMessage v6 has no .content property — parts[] is the only source
  return '';
}

// trimHistory et stripHeavyFields → lib/chat/trim-history.ts (testable)

// =============================================================================
// POST /api/chat — streamText (Vercel AI SDK v6)
// =============================================================================

export async function POST(request: NextRequest) {
  // Prendre la dernière IP du header (ajoutée par Vercel/CDN, non forgeable par le client)
  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const ip = forwarded.split(',').at(-1)?.trim() || 'anon';
  const rl  = await checkRateLimit(ip);
  if (!rl.ok) {
    return new Response(
      JSON.stringify({ error: `RATE_LIMIT:${rl.retrySec}` }),
      { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(rl.retrySec) } }
    );
  }

  try {
    const t0 = Date.now();

    // ── Session + catégories en parallèle (indépendants) ─────────────────────
    const [session, categoriesList] = await Promise.all([
      getSessionOrg(request),
      getDistinctCategories(),
    ]);

    // Rate-limit par utilisateur authentifié (10 req/60s) — vient s'ajouter au
    // rate-limit IP existant ci-dessus (protection coût LLM par compte).
    const userRl = await chatUserLimiter(`${session?.userId ?? 'anon'}:${getClientKey(request)}`);
    if (!userRl.ok) {
      return new Response(
        JSON.stringify({ error: `RATE_LIMIT:${userRl.retrySec}` }),
        { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(userRl.retrySec) } }
      );
    }

    // getOrgSourceIds dépend de session — reste séquentiel
    const orgSourceIds = await getOrgSourceIds(session);

    logger.debug('CHAT', `pre-LLM ${Date.now() - t0} ms | session: ${session?.orgId ?? 'null'} ${session?.role ?? 'no-session'} | sources: ${orgSourceIds === null ? 'all' : orgSourceIds.length}`);

    const corps = await lireCorps(request, ConversationSchema);
    if (!corps.ok) {
      // Cette route n'importe pas `NextResponse` : elle rend des flux.
      return Response.json({ error: corps.message }, { status: 400 });
    }
    // Voir le commentaire du schema : `messages` traverse tel quel, seule sa
    // forme de tableau non vide est garantie.
    const messages = corps.valeur.messages as UIMessage[];
    const { forceRecalculate, provider } = corps.valeur;

    // Opt-in data.gouv MCP : activé uniquement si l'utilisateur mentionne des mots-clés
    const lastUserText   = extractLastUserText(messages);
    const useDatagouv    = hasDatagouvKeywords(lastUserText);
    const datagouv_tools = useDatagouv ? await loadDatagouvTools() : {};

    const datagouv_addendum = useDatagouv && Object.keys(datagouv_tools).length > 0
      ? '\n\n' + DATAGOUV_SYSTEM_ADDENDUM
      : '';

    const systemPrompt  = buildSystemPrompt(categoriesList) + datagouv_addendum;

    // ── Trim historique : max 8 messages + strip pois des anciens tool results ──
    const trimmedMessages = trimHistory(messages);
    // @ts-expect-error reason: trimHistory returns our internal message shape; convertToModelMessages expects the AI SDK's UIMessage union which we cannot fully model here without leaking SDK internals.
    const modelMessages = await convertToModelMessages(trimmedMessages);
    const selectedModel = createModel(provider);

    const t1 = Date.now();
    const result = orgContextStorage.run({ orgSourceIds }, () => streamText({
      model:       selectedModel,
      system:      systemPrompt,
      messages:    modelMessages,
      stopWhen:    stepCountIs(3),
      temperature: 0.1,
      maxRetries:  getMaxRetries(provider),
      tools: {
        ...buildTools(categoriesList, forceRecalculate),
        // data.gouv.fr MCP tools — injectés dynamiquement si mots-clés détectés
        ...datagouv_tools,
      },
      // Désactive le "thinking" de Gemini 2.5-flash → coût identique à 1.5-flash
      providerOptions: provider === 'gemini' ? {
        google: { thinkingConfig: { thinkingBudget: 0 } },
      } : undefined,
      onFinish: ({ usage }) => {
        logger.info('CHAT', `LLM total: ${Date.now() - t1}ms | tokens — in:${usage.inputTokens} out:${usage.outputTokens}`);
      },
    }));

    // Accumule l'usage total sur tous les steps (agentic = plusieurs finish-step)
    let cumTokIn = 0, cumTokOut = 0;
    return result.toUIMessageStreamResponse({
      messageMetadata: ({ part }) => {
        interface UsageShape {
          usage?: {
            promptTokens?: number;
            completionTokens?: number;
            inputTokens?: number;
            outputTokens?: number;
          };
        }
        const partUsage = (part as UsageShape).usage;
        if (part.type === 'finish-step' && partUsage) {
          cumTokIn  += partUsage.promptTokens  ?? partUsage.inputTokens  ?? 0;
          cumTokOut += partUsage.completionTokens ?? partUsage.outputTokens ?? 0;
          return { tok_in: cumTokIn, tok_out: cumTokOut };
        }
        return undefined;
      },
    });

  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : 'Erreur inconnue';
    const isRateLimit = msg.includes('Rate limit') || msg.includes('rate_limit') || msg.includes('429')
      || (error as { statusCode?: number }).statusCode === 429
      || msg.toLowerCase().includes('quota exceeded')    // Gemini quota
      || msg.toLowerCase().includes('exceeded your current quota'); // Gemini quota v2

    // Extraire le délai de retry depuis le message Gemini ("retry in 16.7s")
    const retryMatch = msg.match(/retry in (\d+(?:\.\d+)?)s/i);
    const retrySec   = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 0;

    console.error(`[chat] Erreur${isRateLimit ? ' (rate limit)' : ''}:`, msg.substring(0, 200));
    return new Response(
      JSON.stringify({ error: isRateLimit ? `RATE_LIMIT:${retrySec}` : msg }),
      { status: isRateLimit ? 429 : 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
