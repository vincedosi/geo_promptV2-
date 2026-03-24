import { NextRequest } from 'next/server';
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

// Timeout étendu pour les retries ORS (rate limit 20s × max 3 × N batches)
export const maxDuration = 120;

// ── Rate limiter : Upstash Redis (prod multi-instance) ou in-memory (dev) ─────
// Pour activer Upstash : ajouter UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN dans .env.local
// Sans ces vars → fallback in-memory (fonctionne en dev, pas sur Vercel multi-instance)
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const RL_MAX    = 12;
const RL_WINDOW = '60 s' as const;

// Upstash sliding window — partagé entre toutes les instances Vercel
const upstashRatelimit = (
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
) ? new Ratelimit({
  redis: new Redis({
    url:   process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  }),
  limiter:   Ratelimit.slidingWindow(RL_MAX, RL_WINDOW),
  prefix:    'geo:rl',
  analytics: false,
}) : null;

// Fallback in-memory (dev local sans Upstash configuré)
const RL_MAP: Map<string, { count: number; resetAt: number }> = new Map();

async function checkRateLimit(ip: string): Promise<{ ok: boolean; retrySec: number }> {
  if (upstashRatelimit) {
    const { success, reset } = await upstashRatelimit.limit(ip);
    return { ok: success, retrySec: success ? 0 : Math.ceil((reset - Date.now()) / 1000) };
  }
  // Fallback in-memory
  const now = Date.now();
  const e   = RL_MAP.get(ip);
  if (!e || now >= e.resetAt) {
    RL_MAP.set(ip, { count: 1, resetAt: now + 60_000 });
    return { ok: true, retrySec: 0 };
  }
  if (e.count >= RL_MAX) {
    return { ok: false, retrySec: Math.ceil((e.resetAt - now) / 1000) };
  }
  e.count++;
  return { ok: true, retrySec: 0 };
}

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

    // getOrgSourceIds dépend de session — reste séquentiel
    const orgSourceIds = await getOrgSourceIds(session);

    console.log('[CHAT] pre-LLM:', Date.now() - t0, 'ms |',
      'session:', session?.orgId ?? 'null', session?.role ?? 'no-session',
      '| sources:', orgSourceIds === null ? 'all' : orgSourceIds.length);

    const body = await request.json() as {
      messages: UIMessage[]; forceRecalculate?: boolean; provider?: Provider;
    };
    const { messages, forceRecalculate = false, provider = 'gemini' } = body;

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
    const modelMessages = await convertToModelMessages(trimmedMessages as any);
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
        console.log(`[CHAT] LLM total: ${Date.now() - t1}ms | tokens — input:${usage.inputTokens} output:${usage.outputTokens} total:${usage.totalTokens}`);
      },
    }));

    // Accumule l'usage total sur tous les steps (agentic = plusieurs finish-step)
    let cumTokIn = 0, cumTokOut = 0;
    return result.toUIMessageStreamResponse({
      messageMetadata: ({ part }) => {
        if (part.type === 'finish-step' && (part as any).usage) {
          const u = (part as any).usage;
          cumTokIn  += u.promptTokens  ?? u.inputTokens  ?? 0;
          cumTokOut += u.completionTokens ?? u.outputTokens ?? 0;
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
