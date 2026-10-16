import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Upstash renseigné vers un hôte MORT (lot 3, revue finale, F4).
 *
 * Deux variables `UPSTASH_*` peuvent rester posées vers une base supprimée. Trois défauts en découlaient :
 *  - `@upstash/redis` RETENTE 5 fois par défaut, avec un recul exponentiel : chaque requête à quota payait ces
 *    tentatives avant le repli ;
 *  - `@upstash/ratelimit` rend `success: true, reason: 'timeout'` au bout de 5 s — une AUTORISATION silencieuse,
 *    sans le compteur en base ;
 *  - chaque appel retentait Upstash et écrivait un log.
 *
 * Ce qui est vérifié : aucune nouvelle tentative côté Redis, un délai traité comme un ÉCHEC (repli sur
 * `consommer_quota`), et un disjoncteur de module — après un échec, Upstash n'est plus tenté pendant 5 min, un seul log.
 */

const appelsRpc: { nom: string; args: Record<string, unknown> }[] = [];
const verdictBase: { data: unknown; error: { message: string } | null } = { data: null, error: null };
const optionsRedis: unknown[] = [];
const optionsRatelimit: Record<string, unknown>[] = [];
const limite = vi.fn<(cle: string) => Promise<{ success: boolean; reset: number; reason?: string }>>();

vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    rpc: (nom: string, args: Record<string, unknown>) => {
      appelsRpc.push({ nom, args });
      return Promise.resolve(verdictBase);
    },
  }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor(o: unknown) { optionsRedis.push(o); }
  },
}));
vi.mock('@upstash/ratelimit', () => {
  class Ratelimit {
    static slidingWindow = () => 'fenetre';
    constructor(o: Record<string, unknown>) { optionsRatelimit.push(o); }
    limit = (cle: string) => limite(cle);
  }
  return { Ratelimit };
});

let erreurs: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://hote-supprime.upstash.io');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'jeton-mort');
  appelsRpc.length = 0;
  optionsRedis.length = 0;
  optionsRatelimit.length = 0;
  limite.mockReset();
  verdictBase.data = { ok: false, retry_s: 17 };
  verdictBase.error = null;
  erreurs = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  erreurs.mockRestore();
});

async function limiteur() {
  const { createRateLimiter } = await import('@/lib/api/rate-limit');
  return createRateLimiter({ max: 12, window: '60 s', prefix: 'geo:rl:test-upstash' });
}

describe('quota — Upstash renseigné vers un hôte injoignable', () => {
  it('le client Redis ne retente pas (sans quoi chaque requête paie cinq tentatives)', async () => {
    await limiteur();
    expect(optionsRedis).toHaveLength(1);
    expect(optionsRedis[0]).toMatchObject({ retry: { retries: 0 } });
  });

  it('hôte injoignable : repli sur le compteur en base, dont le refus est rendu tel quel', async () => {
    limite.mockRejectedValue(new Error('getaddrinfo ENOTFOUND hote-supprime.upstash.io'));
    const r = await (await limiteur())('u1');
    expect(r).toEqual({ ok: false, retrySec: 17 });
    expect(appelsRpc.map((a) => a.nom)).toEqual(['consommer_quota']);
  });

  it('un délai dépassé n’est JAMAIS une autorisation : repli sur la base', async () => {
    limite.mockResolvedValue({ success: true, reset: 0, reason: 'timeout' });
    const r = await (await limiteur())('u1');
    expect(r.ok).toBe(false);
    expect(appelsRpc).toHaveLength(1);
  });

  it('disjoncteur : le 2e appel ne retente pas Upstash, un seul log', async () => {
    limite.mockRejectedValue(new Error('getaddrinfo ENOTFOUND hote-supprime.upstash.io'));
    const l = await limiteur();
    await l('u1');
    await l('u2');
    await l('u3');
    expect(limite).toHaveBeenCalledTimes(1);
    expect(appelsRpc).toHaveLength(3);
    expect(erreurs).toHaveBeenCalledTimes(1);
  });

  it('le disjoncteur vaut pour tout le module : un AUTRE limiteur ne retente pas non plus', async () => {
    limite.mockRejectedValue(new Error('ECONNREFUSED'));
    const { createRateLimiter } = await import('@/lib/api/rate-limit');
    await createRateLimiter({ max: 1, window: '60 s', prefix: 'a' })('u');
    await createRateLimiter({ max: 1, window: '60 s', prefix: 'b' })('u');
    expect(limite).toHaveBeenCalledTimes(1);
  });

  it('Upstash est retenté après 5 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    limite.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const l = await limiteur();
    await l('u1');
    vi.setSystemTime(Date.now() + 4 * 60_000);
    await l('u1');
    expect(limite).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 61_000);
    limite.mockResolvedValueOnce({ success: true, reset: 0 });
    expect(await l('u1')).toEqual({ ok: true, retrySec: 0 });
    expect(limite).toHaveBeenCalledTimes(2);
  });

  it('Upstash joignable : son verdict est rendu, la base n’est pas lue', async () => {
    limite.mockResolvedValue({ success: true, reset: 0 });
    expect(await (await limiteur())('u1')).toEqual({ ok: true, retrySec: 0 });
    expect(appelsRpc).toHaveLength(0);
  });
});
