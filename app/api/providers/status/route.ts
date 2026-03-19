import { NextResponse } from 'next/server';

// Cache 5 minutes
const CACHE_TTL = 5 * 60_000;

let mistralCache: { remaining: number; limit: number; ts: number } | null = null;

export async function GET() {
  const now = Date.now();

  // ── Mistral ──────────────────────────────────────────────────────────────────
  if (!mistralCache || now - mistralCache.ts > CACHE_TTL) {
    try {
      const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.MISTRAL_API_KEY ?? ''}`,
        },
        body: JSON.stringify({
          model: 'mistral-small-latest',
          messages: [{ role: 'user', content: 'ok' }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(8000),
      });
      const remaining = parseInt(res.headers.get('x-ratelimit-remaining-tokens-month') ?? '-1', 10);
      const limit     = parseInt(res.headers.get('x-ratelimit-limit-tokens-month')     ?? '4000000', 10);
      mistralCache = { remaining, limit, ts: now };
    } catch {
      // garder le cache précédent si dispo
    }
  }

  // ── Gemini — on vérifie juste la présence de la clé (pas d'appel API) ───────
  const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '';
  const geminiStatus = geminiKey
    ? { keyPresent: true, available: true }
    : { keyPresent: false, available: false };

  return NextResponse.json({
    mistral: mistralCache
      ? { remaining: mistralCache.remaining, limit: mistralCache.limit }
      : null,
    gemini: geminiStatus,
  });
}
