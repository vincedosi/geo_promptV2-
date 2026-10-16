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
 *  1. **Upstash**, s'il est configuré — le moins cher, rien à changer. Des
 *     variables mortes (hôte supprimé) sont neutralisées par un disjoncteur :
 *     aucune nouvelle tentative, un délai n'autorise jamais, et après un échec
 *     Upstash n'est plus tenté pendant 5 min (un seul log) ;
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

/**
 * Disjoncteur d'Upstash, commun à TOUS les limiteurs du module. Des variables
 * `UPSTASH_*` peuvent rester posées vers une base supprimée (variables mortes) :
 * après un échec, Upstash n'est plus tenté pendant 5 min — chaque requête à
 * quota ne paie donc pas un aller-retour perdu, et le log n'est écrit qu'une
 * fois par coupure.
 */
const DUREE_COUPURE_UPSTASH_MS = 5 * 60_000;
let upstashCoupeJusqua = 0;

/** Délai d'Upstash (ms) : au-delà, `limit()` rend `reason: 'timeout'`, traité comme un échec. */
const DELAI_UPSTASH_MS = 2_000;

function couperUpstash(cause: string): void {
  upstashCoupeJusqua = Date.now() + DUREE_COUPURE_UPSTASH_MS;
  console.error(`[rate-limit] Upstash injoignable (${cause}) : repli sur le compteur en base, Upstash n'est plus tenté pendant 5 min.`);
}

export function createRateLimiter({ max, window, prefix }: RateLimitOptions): RateLimiter {
  const upstash = (
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ) ? new Ratelimit({
    redis: new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
      // Par défaut, 5 nouvelles tentatives à recul exponentiel : un hôte mort
      // coûtait plusieurs secondes à CHAQUE requête avant le repli.
      retry: { retries: 0 },
    }),
    limiter:   Ratelimit.slidingWindow(max, window),
    prefix,
    analytics: false,
    // Au-delà du délai, la bibliothèque rend `success: true, reason: 'timeout'`
    // — une autorisation silencieuse. Le délai est gardé (il borne l'attente),
    // mais son verdict est refusé plus bas : jamais d'autorisation par délai.
    timeout: DELAI_UPSTASH_MS,
  }) : null;

  const windowMs = parseWindowMs(window);
  if (!fallbackMaps.has(prefix)) fallbackMaps.set(prefix, new Map());
  const localMap = fallbackMaps.get(prefix)!;

  return async (key: string) => {
    if (upstash && Date.now() >= upstashCoupeJusqua) {
      // Un limiteur dont le dos est injoignable ne doit PAS faire echouer la
      // requete qu'il protege : les deux variables Upstash peuvent etre
      // renseignees vers un hote qui ne resout plus (base supprimee, DNS, dev
      // local). Sans ce filet, `upstash.limit()` leve et la route repond 500 —
      // constate le 2026-09-13 sur ENOTFOUND, et cela vaut pour TOUTES les
      // routes a quota, pas seulement celle qui l'a revele.
      try {
        const { success, reset, reason } = await upstash.limit(key);
        if (reason === 'timeout') {
          couperUpstash(`délai de ${DELAI_UPSTASH_MS} ms dépassé`);
        } else {
          return { ok: success, retrySec: success ? 0 : Math.ceil((reset - Date.now()) / 1000) };
        }
      } catch (e) {
        couperUpstash(e instanceof Error ? e.message : String(e));
      }
    }

    // Pas d'Upstash (ou Upstash coupé par le disjoncteur) : le compteur partagé
    // en base prend le relais. C'est le chemin réel, les variables Upstash
    // étant vides — ou mortes.
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
