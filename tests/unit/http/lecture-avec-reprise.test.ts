import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchLectureAvecReprise, attenteParDefaut } from '@/lib/http/lecture-avec-reprise';
import { DelaiDepasseError } from '@/lib/http/fetch-avec-delai';

/**
 * Lectures sortantes avec reprise — le patron que la météo (Open-Meteo), les
 * isochrones (ORS), le géocodage (BAN) et le résolveur géo recopiaient chacun
 * à leur manière, avec chacun son oubli : un délai posé sur une tentative et
 * pas sur la suivante, un 429 rejoué sans attendre, une erreur réseau qui
 * sortait de la boucle.
 *
 * Ces tests fixent le contrat : QUAND on reprend, COMBIEN de fois, et
 * COMBIEN de temps on attend. `dormir` est injecté pour que la suite reste
 * instantanée.
 */

const vraiFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = vraiFetch; });

const sansAttente = { dormir: async () => {} };

function reponses(...statuts: number[]) {
  let i = 0;
  const appels: number[] = [];
  globalThis.fetch = (async () => {
    const s = statuts[Math.min(i, statuts.length - 1)];
    appels.push(s);
    i++;
    return new Response(`corps-${s}`, { status: s });
  }) as never;
  return appels;
}

describe('fetchLectureAvecReprise', () => {
  it('rend la première réponse OK sans rien rejouer', async () => {
    const appels = reponses(200);
    const r = await fetchLectureAvecReprise('https://exemple.test/x', {}, sansAttente);
    expect(r.status).toBe(200);
    expect(appels).toEqual([200]);
  });

  it('reprend sur 503 puis rend la réponse qui a fini par passer', async () => {
    const appels = reponses(503, 503, 200);
    const r = await fetchLectureAvecReprise('https://exemple.test/x', {}, { ...sansAttente, tentatives: 3 });
    expect(r.status).toBe(200);
    expect(appels).toEqual([503, 503, 200]);
  });

  it('ne reprend JAMAIS sur un 4xx ordinaire — rejouer un 400 ne le corrigera pas', async () => {
    const appels = reponses(400, 200);
    const r = await fetchLectureAvecReprise('https://exemple.test/x', {}, sansAttente);
    expect(r.status).toBe(400);
    expect(appels).toEqual([400]);
  });

  it("s'arrête au nombre de tentatives et rend la DERNIÈRE réponse, pour que l'appelant garde son message", async () => {
    const appels = reponses(429);
    const r = await fetchLectureAvecReprise('https://exemple.test/x', {}, { ...sansAttente, tentatives: 3 });
    expect(r.status).toBe(429);
    expect(appels).toHaveLength(3);
    // La réponse rendue est lisible : le corps n'a pas été consommé par la reprise.
    expect(await r.text()).toBe('corps-429');
  });

  it('reprend sur expiration du délai, et lève la DERNIÈRE expiration si rien ne passe', async () => {
    let n = 0;
    globalThis.fetch = ((_u: string, init: RequestInit) => new Promise((_, rejette) => {
      n++;
      init.signal?.addEventListener('abort', () => {
        const e = new Error('The operation was aborted');
        e.name = 'AbortError';
        rejette(e);
      });
    })) as never;

    await expect(
      fetchLectureAvecReprise('https://exemple.test/lent', {}, { ...sansAttente, delaiMs: 20, tentatives: 2 }),
    ).rejects.toBeInstanceOf(DelaiDepasseError);
    expect(n).toBe(2);
  });

  it('reprend sur une erreur réseau puis réussit', async () => {
    let n = 0;
    globalThis.fetch = (async () => {
      n++;
      if (n === 1) throw new TypeError('fetch failed');
      return new Response('ok', { status: 200 });
    }) as never;
    const r = await fetchLectureAvecReprise('https://exemple.test/x', {}, sansAttente);
    expect(r.status).toBe(200);
    expect(n).toBe(2);
  });

  it("respecte le délai demandé par `attente` — et `null` arrête net la reprise", async () => {
    const attentes: number[] = [];
    const appels = reponses(429, 429, 429, 200);
    const r = await fetchLectureAvecReprise('https://exemple.test/x', {}, {
      tentatives: 10,
      attente: (tentative, cause) => {
        if (cause.type !== 'statut') return null;
        return tentative >= 2 ? null : 1_000 * (tentative + 1);
      },
      dormir: async (ms) => { attentes.push(ms); },
    });
    expect(r.status).toBe(429);
    expect(attentes).toEqual([1_000, 2_000]);
    expect(appels).toEqual([429, 429, 429]);
  });

  it("n'attend pas et ne rejoue pas quand c'est l'APPELANT qui annule", async () => {
    const ctrl = new AbortController();
    let n = 0;
    globalThis.fetch = ((_u: string, init: RequestInit) => new Promise((_, rejette) => {
      n++;
      init.signal?.addEventListener('abort', () => {
        const e = new Error('The operation was aborted');
        e.name = 'AbortError';
        rejette(e);
      });
    })) as never;
    const p = fetchLectureAvecReprise('https://exemple.test/x', { signal: ctrl.signal }, { ...sansAttente, tentatives: 5 });
    ctrl.abort();
    await expect(p).rejects.toThrow();
    expect(n).toBe(1);
  });

  it('transmet méthode, en-têtes et corps à CHAQUE tentative, pas seulement la première', async () => {
    const recus: RequestInit[] = [];
    let n = 0;
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      recus.push(init);
      n++;
      return new Response('', { status: n === 1 ? 503 : 200 });
    }) as never;
    await fetchLectureAvecReprise('https://exemple.test/x', {
      method: 'POST', headers: { Authorization: 'Bearer j' }, body: '{"a":1}',
    }, sansAttente);
    expect(recus).toHaveLength(2);
    for (const init of recus) {
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer j');
      expect(init.body).toBe('{"a":1}');
    }
  });
});

describe('attenteParDefaut', () => {
  const statut = (s: number, retryAfter?: string) => ({
    type: 'statut' as const,
    reponse: new Response('', { status: s, headers: retryAfter ? { 'Retry-After': retryAfter } : {} }),
  });

  it('reprend sur 429 et 5xx, jamais sur les autres 4xx', () => {
    expect(attenteParDefaut(0, statut(429))).not.toBeNull();
    expect(attenteParDefaut(0, statut(502))).not.toBeNull();
    expect(attenteParDefaut(0, statut(503))).not.toBeNull();
    expect(attenteParDefaut(0, statut(504))).not.toBeNull();
    expect(attenteParDefaut(0, statut(400))).toBeNull();
    expect(attenteParDefaut(0, statut(401))).toBeNull();
    expect(attenteParDefaut(0, statut(404))).toBeNull();
  });

  it('honore Retry-After en secondes, plafonné pour ne pas figer une invocation serverless', () => {
    expect(attenteParDefaut(0, statut(429, '3'))).toBe(3_000);
    expect(attenteParDefaut(0, statut(429, '3600'))).toBe(30_000);
  });

  it("double l'attente à chaque tentative quand le tiers ne dit rien", () => {
    expect(attenteParDefaut(0, statut(503))).toBe(1_000);
    expect(attenteParDefaut(1, statut(503))).toBe(2_000);
    expect(attenteParDefaut(2, statut(503))).toBe(4_000);
    expect(attenteParDefaut(0, { type: 'delai' })).toBe(1_000);
    expect(attenteParDefaut(1, { type: 'reseau', erreur: new Error('x') })).toBe(2_000);
  });
});
