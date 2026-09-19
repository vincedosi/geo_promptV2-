/**
 * MAGELIAN — Quotas d'appels, partagés entre instances.
 *
 * ── Le défaut corrigé (`ECH-004`) ───────────────────────────────────────────
 *
 * Les trois limiteurs du projet comptaient dans la mémoire du PROCESSUS. Sur
 * Vercel, chaque invocation peut être servie par une instance différente :
 * chacune repart de zéro, et « 3 imports par 60 s » ne limite rien.
 *
 * Upstash devait couvrir ce cas, mais ses deux variables d'environnement sont
 * VIDES en production. Le repli mémoire était donc le chemin réel, en
 * permanence — et ce garde-fou est celui qui protège le budget d'I/O de
 * l'instance Nano, dont l'épuisement a mis l'application à terre trois fois.
 *
 * ── Les trois moteurs, dans cet ordre ───────────────────────────────────────
 *
 *  1. **Upstash**, s'il est configuré — le moins cher, rien à changer ;
 *  2. **Postgres** (`consommer_quota`, sql/135) — la seule ressource partagée
 *     dont l'application dispose à coup sûr. Un `INSERT … ON CONFLICT …
 *     RETURNING`, donc exact même quand deux instances appellent ensemble ;
 *  3. **mémoire**, uniquement si la base n'a pas répondu. Ce dernier repli ne
 *     protège rien entre instances : il évite juste qu'une panne de base
 *     bloque tout. On échoue OUVERT, à dessein — l'opération protégée
 *     échouerait de toute façon, et refuser en plus n'apporterait rien.
 */
import { NextResponse } from 'next/server';
import { Ratelimit, type Duration } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { createAdminClient } from '@/lib/auth';
import { logger } from '@/lib/logger';

/**
 * Consomme une unité de quota en base. Rend `null` si la base n'a pas répondu,
 * pour que l'appelant sache qu'il doit se rabattre ailleurs — un `false` serait
 * pris pour « quota dépassé ».
 */
async function consommerEnBase(
  cle: string, max: number, fenetreS: number,
): Promise<{ ok: boolean; retrySec: number } | null> {
  try {
    const { data, error } = await createAdminClient()
      .rpc('consommer_quota', { p_cle: cle, p_max: max, p_fenetre_s: fenetreS });
    if (error || !data) {
      logger.warn('quota', `consommer_quota indisponible (${error?.message ?? 'sans donnee'})`);
      return null;
    }
    const verdict = data as unknown as { ok: boolean; retry_s: number };
    return { ok: verdict.ok, retrySec: verdict.retry_s ?? 0 };
  } catch (err) {
    logger.warn('quota', `consommer_quota a leve : ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Import rate limit (legacy — admin imports)
// ─────────────────────────────────────────────────────────────────────────

const importWindowS = 60;
const importMaxPerWindow = 3;
const importHits = new Map<string, { count: number; resetAt: number }>();

/**
 * Quota des imports d'administration : 3 par minute et par route.
 *
 * **Asynchrone désormais** : le compteur vit en base, sans quoi il ne comptait
 * que pour l'instance qui répondait. C'est le garde-fou le plus important du
 * projet — un import de masse lancé trois fois en parallèle est exactement le
 * scénario des incidents du 28/03 et du 08/04.
 */
export async function checkImportRateLimit(
  key: string,
): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  const partage = await consommerEnBase(`import:${key}`, importMaxPerWindow, importWindowS);
  if (partage) {
    return partage.ok ? { ok: true } : { ok: false, retryAfterSec: partage.retrySec };
  }

  // Repli mémoire : ne vaut que pour cette instance. Voir l'en-tête du fichier.
  const now = Date.now();
  const entry = importHits.get(key);
  if (!entry || now > entry.resetAt) {
    importHits.set(key, { count: 1, resetAt: now + importWindowS * 1000 });
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
      // Un limiteur dont le dos est injoignable ne doit PAS faire echouer la
      // requete qu'il protege : les deux variables Upstash peuvent etre
      // renseignees vers un hote qui ne resout plus (base supprimee, DNS, dev
      // local). Sans ce filet, `upstash.limit()` leve et la route repond 500 —
      // constate le 2026-09-13 sur ENOTFOUND, et cela vaut pour TOUTES les
      // routes a quota, pas seulement celle qui l'a revele.
      try {
        const { success, reset } = await upstash.limit(key);
        return { ok: success, retrySec: success ? 0 : Math.ceil((reset - Date.now()) / 1000) };
      } catch (e) {
        console.error('[rate-limit] Upstash injoignable, repli sur le compteur en base:', e instanceof Error ? e.message : e);
      }
    }

    // Pas d'Upstash : le compteur partagé en base prend le relais. C'est le
    // chemin réel en production, où les deux variables Upstash sont vides.
    const partage = await consommerEnBase(`${prefix}:${key}`, max, Math.round(windowMs / 1000));
    if (partage) return partage;

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
