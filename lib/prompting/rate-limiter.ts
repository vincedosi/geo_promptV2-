/**
 * Pattern 4 — Rate limiting per-user pour endpoints LLM.
 *
 * Wrapper autour du module existant `lib/api/rate-limit` avec defaults adaptés
 * aux appels LLM (5 req/60s par défaut, override possible).
 *
 * Extrait du `createRateLimiter({ max: 5, window: '60 s', prefix: '...' })`
 * utilisé par BiddingCopilot.
 */
import type { NextRequest } from 'next/server';
import { createRateLimiter, getClientKey, rateLimitResponse } from '@/lib/api/rate-limit';

const DEFAULTS = {
  max: 5,
  window: '60 s' as const,
};

/**
 * Crée un limiter LLM-friendly (5 req/min par user+IP).
 * Le `prefix` doit être unique par feature (ex. `'agent:analyze-drift'`).
 */
export function createLLMRateLimiter(opts: { prefix: string; max?: number; window?: '60 s' | '5 m' | '1 h' }) {
  return createRateLimiter({
    max: opts.max ?? DEFAULTS.max,
    window: opts.window ?? DEFAULTS.window,
    prefix: opts.prefix,
  });
}

/**
 * Helper "tout-en-un" : enforce le rate limit et retourne la response 429
 * si dépassement, sinon `null` pour indiquer qu'on peut continuer.
 *
 *   const limiter = createLLMRateLimiter({ prefix: 'agent:chat' });
 *   ...
 *   const blocked = await enforceLLMRateLimit(limiter, profile.id, request);
 *   if (blocked) return blocked;
 */
export async function enforceLLMRateLimit(
  limiter: ReturnType<typeof createLLMRateLimiter>,
  userId: string,
  request: NextRequest,
): Promise<Response | null> {
  const { ok, retrySec } = await limiter(`${userId}:${getClientKey(request)}`);
  if (!ok) return rateLimitResponse(retrySec);
  return null;
}

export { getClientKey, rateLimitResponse };
