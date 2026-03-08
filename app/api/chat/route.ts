import { NextRequest } from 'next/server';
import { streamText, convertToModelMessages, stepCountIs } from 'ai';
import { getDistinctCategories } from '@/lib/poi/categories';
import { hasDatagouvKeywords, loadDatagouvTools, DATAGOUV_SYSTEM_ADDENDUM } from '@/lib/mcp/datagouv';
import { createModel, getMaxRetries, type Provider } from '@/lib/chat/providers';
import { buildSystemPrompt } from '@/lib/chat/system-prompt';
import { buildTools } from '@/lib/chat/tools';

// Timeout étendu pour les retries ORS (rate limit 20s × max 3 × N batches)
export const maxDuration = 120;

// ── Rate limiter in-memory (12 req/min/IP) ────────────────────────────────────
const RL_MAP = new Map<string, { count: number; resetAt: number }>();
const RL_MAX = 12;
const RL_WINDOW_MS = 60_000;

function checkRateLimit(ip: string): { ok: boolean; retrySec: number } {
  const now = Date.now();
  const e   = RL_MAP.get(ip);
  if (!e || now >= e.resetAt) {
    RL_MAP.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS });
    return { ok: true, retrySec: 0 };
  }
  if (e.count >= RL_MAX) {
    return { ok: false, retrySec: Math.ceil((e.resetAt - now) / 1000) };
  }
  e.count++;
  return { ok: true, retrySec: 0 };
}

// ── Extraction du texte du dernier message utilisateur ────────────────────────
function extractLastUserText(messages: any[]): string {
  const last = [...messages].reverse().find((m: any) => m.role === 'user');
  if (!last) return '';
  const content = last.content;
  if (typeof content === 'string' && content) return content;
  if (Array.isArray(content)) {
    const txt = content.filter((p: any) => p.type === 'text').map((p: any) => p.text).join(' ');
    if (txt) return txt;
  }
  // AI SDK React useChat envoie parts[] et non content
  const parts = (last as any).parts;
  if (Array.isArray(parts)) {
    return parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join(' ');
  }
  return typeof content === 'string' ? content : '';
}

// =============================================================================
// POST /api/chat — streamText (Vercel AI SDK v6)
// =============================================================================

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'anon';
  const rl  = checkRateLimit(ip);
  if (!rl.ok) {
    return new Response(
      JSON.stringify({ error: `RATE_LIMIT:${rl.retrySec}` }),
      { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(rl.retrySec) } }
    );
  }

  try {
    const body = await request.json() as {
      messages: any[]; forceRecalculate?: boolean; provider?: Provider;
    };
    const { messages, forceRecalculate = false, provider = 'mistral' } = body;

    const categoriesList = await getDistinctCategories();
    console.log('[chat] Catégories dynamiques:', categoriesList);

    // Opt-in data.gouv MCP : activé uniquement si l'utilisateur mentionne des mots-clés
    const lastUserText = extractLastUserText(messages);
    console.log('[chat] lastUserText:', JSON.stringify(lastUserText).substring(0, 120));

    const useDatagouv      = hasDatagouvKeywords(lastUserText);
    const datagouv_tools   = useDatagouv ? await loadDatagouvTools() : {};
    console.log('[chat] datagouv:', useDatagouv, '—', Object.keys(datagouv_tools).length, 'tools');

    const datagouv_addendum = useDatagouv && Object.keys(datagouv_tools).length > 0
      ? '\n\n' + DATAGOUV_SYSTEM_ADDENDUM
      : '';

    const systemPrompt  = buildSystemPrompt(categoriesList) + datagouv_addendum;
    const modelMessages = await convertToModelMessages(messages as any);
    const selectedModel = createModel(provider);

    const result = streamText({
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
    });

    console.log(`[chat] streamText started — provider=${provider}, MCP=${Object.keys(datagouv_tools).length} tools`);
    return result.toUIMessageStreamResponse();

  } catch (error: any) {
    const msg: string = error.message ?? 'Erreur inconnue';
    const isRateLimit = msg.includes('Rate limit') || msg.includes('rate_limit') || msg.includes('429')
      || error.statusCode === 429
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
