/**
 * GEOMATIK — Rate limiters partagés.
 *
 * 1. checkImportRateLimit() — limiteur in-memory simple pour routes d'import admin
 *    (3 req/60s, partage par clé route). Pas multi-instance.
 *
 * 2. createRateLimiter() — usine pour routes IA / coûteuses :
 *    Upstash Redis (prod multi-instance Vercel) ou fallback in-memory (dev).
 *    Pattern aligné sur app/api/chat/route.ts.
 */
import { NextResponse } from 'next/server';
import { Ratelimit, type Duration } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// ─────────────────────────────────────────────────────────────────────────
// 1. Import rate limit (legacy — admin imports)
// ─────────────────────────────────────────────────────────────────────────

const importWindowMs = 60_000;
const importMaxPerWindow = 3;
const importHits = new Map<string, { count: number; resetAt: number }>();

export function checkImportRateLimit(key: string): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const entry = importHits.get(key);

  if (!entry || now > entry.resetAt) {
    importHits.set(key, { count: 1, resetAt: now + importWindowMs });
    return { ok: true };
  }

  if (entry.count >= importMaxPerWindow) {
    return { ok: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }

  entry.count++;
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Rate limiter générique (routes IA / endpoints coûteux)
// ─────────────────────────────────────────────────────────────────────────

interface RateLimitOptions {
  max: number;
  window: Duration;
  /** Préfixe Upstash unique par route (évite collisions inter-routes). */
  prefix: string;
}

export type RateLimiter = (key: string) => Promise<{ ok: boolean; retrySec: number }>;

const fallbackMaps = new Map<string, Map<string, { count: number; resetAt: number }>>();

function parseWindowMs(window: Duration): number {
  const m = /^(\d+)\s*(s|m|h|d)?$/.exec(String(window));
  if (!m) return 60_000;
  const n = parseInt(m[1], 10);
  const unit = m[2] ?? 's';
  switch (unit) {
    case 'h': return n * 3_600_000;
    case 'm': return n * 60_000;
    case 'd': return n * 86_400_000;
    default:  return n * 1_000;
  }
}

export function createRateLimiter({ max, window, prefix }: RateLimitOptions): RateLimiter {
  const upstash = (
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ) ? new Ratelimit({
    redis: new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    }),
    limiter:   Ratelimit.slidingWindow(max, window),
    prefix,
    analytics: false,
  }) : null;

  const windowMs = parseWindowMs(window);
  if (!fallbackMaps.has(prefix)) fallbackMaps.set(prefix, new Map());
  const localMap = fallbackMaps.get(prefix)!;

  return async (key: string) => {
    if (upstash) {
      const { success, reset } = await upstash.limit(key);
      return { ok: success, retrySec: success ? 0 : Math.ceil((reset - Date.now()) / 1000) };
    }
    const now = Date.now();
    const e = localMap.get(key);
    if (!e || now >= e.resetAt) {
      localMap.set(key, { count: 1, resetAt: now + windowMs });
      return { ok: true, retrySec: 0 };
    }
    if (e.count >= max) {
      return { ok: false, retrySec: Math.ceil((e.resetAt - now) / 1000) };
    }
    e.count++;
    return { ok: true, retrySec: 0 };
  };
}

export function rateLimitResponse(retrySec: number): NextResponse {
  return NextResponse.json(
    { error: 'Trop de requêtes. Réessayez dans quelques instants.', retry_after: retrySec },
    { status: 429, headers: { 'Retry-After': String(retrySec) } }
  );
}

export function getClientKey(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() || 'anon';
  return request.headers.get('x-real-ip')?.trim() || 'anon';
}
