/**
 * Simple in-memory rate limiter for admin import routes.
 * Prevents abuse by limiting concurrent/frequent heavy operations.
 *
 * Not shared across Vercel instances — acceptable for admin routes
 * that are rarely called in parallel from different edge locations.
 */

const windowMs = 60_000; // 60 seconds
const maxPerWindow = 3;

const hits = new Map<string, { count: number; resetAt: number }>();

/**
 * Check and consume a rate limit slot.
 * @param key Unique key (e.g. route path or "import-ooh")
 * @returns { ok: true } if allowed, { ok: false, retryAfterSec } if blocked
 */
export function checkImportRateLimit(key: string): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || now > entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }

  if (entry.count >= maxPerWindow) {
    return { ok: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }

  entry.count++;
  return { ok: true };
}
