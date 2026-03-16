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

// ── Trim historique : limite à 8 messages et strip les gros champs des tool results anciens ──
// pois[], isochroneGeoJSON, voronoiGeoJSON.features, poisForMap.pois peuvent peser 50k+ tokens.
function stripHeavyFields(result: any): any {
  if (!result || typeof result !== 'object') return result;
  let r = result;

  // Strip pois[]
  if (Array.isArray(r.pois)) {
    const { pois, ...rest } = r;
    r = { ...rest, pois: [], nb_pois: pois.length, _stripped: true };
  }

  // Strip isochroneGeoJSON (polygones ORS — très volumineux)
  if (r.isochroneGeoJSON && typeof r.isochroneGeoJSON === 'object') {
    const nb = Array.isArray(r.isochroneGeoJSON.features) ? r.isochroneGeoJSON.features.length : 1;
    r = { ...r, isochroneGeoJSON: { _stripped: true, nb_features: nb } };
  }

  // Strip voronoiGeoJSON.features
  if (r.voronoiGeoJSON && Array.isArray(r.voronoiGeoJSON.features)) {
    const nb = r.voronoiGeoJSON.features.length;
    r = { ...r, voronoiGeoJSON: { ...r.voronoiGeoJSON, features: [], nb_features: nb, _stripped: true } };
  }

  // Strip poisForMap.pois (voronoi_analysis)
  if (r.poisForMap && Array.isArray(r.poisForMap.pois)) {
    const nb = r.poisForMap.pois.length;
    r = { ...r, poisForMap: { ...r.poisForMap, pois: [], nb_pois: nb, _stripped: true } };
  }

  // Strip isochrone_battle features[]
  if (Array.isArray(r.features) && r.features.length > 0 && r.features[0]?.geometry) {
    r = { ...r, features: [], nb_features: r.features.length, _stripped: true };
  }

  return r;
}

function trimHistory(messages: any[]): any[] {
  const MAX_MESSAGES = 8;
  const recent = messages.slice(-MAX_MESSAGES);

  // Dans les messages non-récents (tout sauf le dernier échange), strip les gros champs
  return recent.map((msg: any, idx: number) => {
    const isLast = idx >= recent.length - 2; // garde les 2 derniers messages intacts
    if (isLast) return msg;

    const parts = msg.parts ?? msg.content;
    if (!Array.isArray(parts)) return msg;

    const strippedParts = parts.map((part: any) => {
      if (part.type !== 'tool-result' && part.type !== 'tool_result') return part;
      const result = part.result ?? part.output;
      if (!result || typeof result !== 'object') return part;
      const stripped = stripHeavyFields(result);
      return {
        ...part,
        result: stripped,
        output: part.output ? stripped : undefined,
      };
    });

    return { ...msg, parts: strippedParts };
  });
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
    const { messages, forceRecalculate = false, provider = 'gemini' } = body;

    const categoriesList = await getDistinctCategories();

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
      // Désactive le "thinking" de Gemini 2.5-flash → coût identique à 1.5-flash
      providerOptions: provider === 'gemini' ? {
        google: { thinkingConfig: { thinkingBudget: 0 } },
      } : undefined,
      onFinish: ({ usage }) => {
        console.log(`[chat] tokens — input:${usage.promptTokens} output:${usage.completionTokens} total:${usage.totalTokens}`);
      },
    });

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
