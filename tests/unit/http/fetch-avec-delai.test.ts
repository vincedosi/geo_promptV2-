import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchAvecDelai, DelaiDepasseError, DELAI_DEFAUT_MS } from '@/lib/http/fetch-avec-delai';

/**
 * `ECH-002` — les appels sortants doivent échouer proprement au lieu de pendre.
 *
 * Le test qui compte est le premier : un tiers qui ne répond JAMAIS doit rendre
 * la main. C'était le cas des 13 appels vers DV360, TikTok et Modal avant ce
 * correctif.
 */

const vraiFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = vraiFetch; vi.useRealTimers(); });

describe('fetchAvecDelai', () => {
  it('rend la main quand le tiers ne répond jamais', async () => {
    // Un fetch qui ne se résout pas, mais qui honore le signal d'annulation —
    // exactement le comportement d'un hôte injoignable.
    globalThis.fetch = ((_url: string, init: RequestInit) => new Promise((_, rejette) => {
      init.signal?.addEventListener('abort', () => {
        const e = new Error('The operation was aborted');
        e.name = 'AbortError';
        rejette(e);
      });
    })) as never;

    await expect(fetchAvecDelai('https://exemple.test/lent', {}, 30))
      .rejects.toBeInstanceOf(DelaiDepasseError);
  });

  it("nomme l'hôte et le délai dans l'erreur, pour que le journal soit exploitable", async () => {
    globalThis.fetch = ((_url: string, init: RequestInit) => new Promise((_, rejette) => {
      init.signal?.addEventListener('abort', () => {
        const e = new Error('The operation was aborted');
        e.name = 'AbortError';
        rejette(e);
      });
    })) as never;

    // Sans cette distinction, le journal dirait seulement « The operation was
    // aborted » — inexploitable pour savoir QUI n'a pas répondu.
    await expect(fetchAvecDelai('https://displayvideo.googleapis.com/x', {}, 25))
      .rejects.toThrow(/displayvideo\.googleapis\.com.*25 ms/);
  });

  it('laisse passer une réponse normale sans rien changer', async () => {
    const attendue = new Response('{"ok":true}', { status: 200 });
    globalThis.fetch = (() => Promise.resolve(attendue)) as never;

    const r = await fetchAvecDelai('https://exemple.test/rapide');
    expect(r).toBe(attendue);
    expect(r.status).toBe(200);
  });

  it('transmet la méthode, les en-têtes et le corps sans les altérer', async () => {
    let recu: RequestInit | undefined;
    globalThis.fetch = ((_u: string, init: RequestInit) => {
      recu = init;
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as never;

    await fetchAvecDelai('https://exemple.test/x', {
      method: 'POST',
      headers: { Authorization: 'Bearer jeton' },
      body: '{"a":1}',
      cache: 'no-store',
    });

    expect(recu?.method).toBe('POST');
    expect((recu?.headers as Record<string, string>).Authorization).toBe('Bearer jeton');
    expect(recu?.body).toBe('{"a":1}');
    expect(recu?.cache).toBe('no-store');
  });

  it('propage une erreur réseau réelle telle quelle, sans la déguiser en expiration', async () => {
    globalThis.fetch = (() => Promise.reject(new Error('ECONNREFUSED'))) as never;
    await expect(fetchAvecDelai('https://exemple.test/x')).rejects.toThrow('ECONNREFUSED');
    await expect(fetchAvecDelai('https://exemple.test/x')).rejects.not.toBeInstanceOf(DelaiDepasseError);
  });

  it('respecte un signal fourni par l appelant', async () => {
    const ctrl = new AbortController();
    globalThis.fetch = ((_u: string, init: RequestInit) => new Promise((_, rejette) => {
      init.signal?.addEventListener('abort', () => {
        const e = new Error('The operation was aborted');
        e.name = 'AbortError';
        rejette(e);
      });
    })) as never;

    const p = fetchAvecDelai('https://exemple.test/x', { signal: ctrl.signal }, 10_000);
    ctrl.abort();
    // Annulé par l'appelant, pas par notre minuteur : ce n'est pas une expiration.
    await expect(p).rejects.not.toBeInstanceOf(DelaiDepasseError);
  });

  it('expose un délai par défaut inférieur au délai des plateformes serverless', () => {
    // L'appel doit échouer AVANT la plateforme, sinon on perd le message d'erreur.
    expect(DELAI_DEFAUT_MS).toBeGreaterThan(5_000);
    expect(DELAI_DEFAUT_MS).toBeLessThanOrEqual(20_000);
  });
});
