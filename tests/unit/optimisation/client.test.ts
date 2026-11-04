/**
 * `lib/optimisation/client.ts` (tâche 1.6) : configuration, en-tête de clé, délai, erreurs en français, Zod sur la
 * réponse — `fetch` simulé, aucun service lancé.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import {
  appelerOptimisation, calculerRecalage, ErreurOptimisation,
} from '@/lib/optimisation/client';

const CLE = 'cle-de-test-sans-valeur';
const ALGO = { moteur: 'python', version: '0.1.0', entrees_sha256: 'a'.repeat(64) };
const RECALAGE = { multiplicateurs: [['75011', 1.2], ['13001', 0.8]], corrections: [['b', 1.1]], dilues: [], algo: ALGO };

const repondre = (corps: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(corps), { status, headers: { 'Content-Type': 'application/json' } }));

const ENTREE = {
  cps: [], utiles_observees: [], cible: [], params: { amortissement: 0.8, seuilDilution: 20, baisseDilues: 0.6 },
};

async function erreurDe(p: Promise<unknown>): Promise<ErreurOptimisation> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ErreurOptimisation);
    return e as ErreurOptimisation;
  }
  throw new Error('aucune erreur levée');
}

beforeEach(() => {
  vi.stubEnv('OPTIMISATION_URL', 'http://127.0.0.1:8090/');
  vi.stubEnv('OPTIMISATION_CLE_INTERNE', ` ${CLE} `);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('client du service d’optimisation', () => {
  it('POST JSON vers OPTIMISATION_URL (barre finale retirée), clé dans X-Optimisation-Cle, blancs retirés', async () => {
    const f = repondre(RECALAGE);
    vi.stubGlobal('fetch', f);
    const r = await calculerRecalage(ENTREE);
    expect(r.multiplicateurs).toEqual([['75011', 1.2], ['13001', 0.8]]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8090/v1/historique/recaler');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Optimisation-Cle']).toBe(CLE);
    expect(JSON.parse(init.body as string)).toEqual(ENTREE);
  });

  it('les clés inconnues de la réponse sont GARDÉES (Zod en passthrough : la comparaison ne doit rien perdre)', async () => {
    vi.stubGlobal('fetch', repondre({ ...RECALAGE, nouveau: 1 }));
    const r = await calculerRecalage(ENTREE) as unknown as Record<string, unknown>;
    expect(r.nouveau).toBe(1);
  });

  it.each([
    ['OPTIMISATION_URL', 'OPTIMISATION_URL absente'],
    ['OPTIMISATION_CLE_INTERNE', 'OPTIMISATION_CLE_INTERNE absente'],
  ])('%s absente : erreur de configuration, aucun appel', async (variable, texte) => {
    vi.stubEnv(variable, '');
    const f = repondre(RECALAGE);
    vi.stubGlobal('fetch', f);
    const e = await erreurDe(calculerRecalage(ENTREE));
    expect(e.motif).toBe('configuration');
    expect(e.message).toContain(texte);
    expect(f).not.toHaveBeenCalled();
  });

  it('422 du service : son message français est rendu, avec le motif du refus', async () => {
    vi.stubGlobal('fetch', repondre({ detail: { refus: 'registre', message: 'ttd — aucun mécanisme de poids au CP.' } }, 422));
    const e = await erreurDe(calculerRecalage(ENTREE));
    expect(e).toMatchObject({ motif: 'refus', statut: 422, refus: 'registre', message: 'ttd — aucun mécanisme de poids au CP.' });
  });

  it('401 : le fait, jamais la clé', async () => {
    vi.stubGlobal('fetch', repondre({ detail: 'Clé interne absente ou invalide.' }, 401));
    const e = await erreurDe(calculerRecalage(ENTREE));
    expect(e.motif).toBe('refus');
    expect(e.message).not.toContain(CLE);
  });

  it('503 : indisponible, message du service', async () => {
    vi.stubGlobal('fetch', repondre({ detail: { message: 'Le calcul du plan est indisponible, réessayez dans une minute.' } }, 503));
    const e = await erreurDe(calculerRecalage(ENTREE));
    expect(e).toMatchObject({ motif: 'indisponible', statut: 503 });
    expect(e.message).toMatch(/réessayez/);
  });

  it('500 sans corps lisible : message français générique', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Internal Server Error', { status: 500 })));
    const e = await erreurDe(calculerRecalage(ENTREE));
    expect(e).toMatchObject({ motif: 'serveur', statut: 500 });
    expect(e.message).toMatch(/n'a pas abouti/);
  });

  it('service injoignable : motif réseau, sans URL dans le message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const e = await erreurDe(calculerRecalage(ENTREE));
    expect(e.motif).toBe('reseau');
    expect(e.message).not.toContain('127.0.0.1');
  });

  it('délai dépassé : motif délai, en secondes', async () => {
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_, rejeter) => {
      init.signal?.addEventListener('abort', () => rejeter(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })));
    const e = await erreurDe(calculerRecalage(ENTREE, 20));
    expect(e.motif).toBe('delai');
    expect(e.message).toMatch(/n'a pas répondu en 0 s/);
  });

  it('réponse d’une autre forme que l’OpenAPI : erreur « réponse », le chemin fautif nommé', async () => {
    vi.stubGlobal('fetch', repondre({ ...RECALAGE, multiplicateurs: [['75011', 'un']] }));
    const e = await erreurDe(calculerRecalage(ENTREE));
    expect(e.motif).toBe('reponse');
    expect(e.message).toContain('multiplicateurs.0.1');
  });

  it('algo sans empreinte sha256 : refusé', async () => {
    vi.stubGlobal('fetch', repondre({ ...RECALAGE, algo: { ...ALGO, entrees_sha256: 'x' } }));
    expect((await erreurDe(calculerRecalage(ENTREE))).motif).toBe('reponse');
  });

  it('appelerOptimisation : schéma quelconque', async () => {
    vi.stubGlobal('fetch', repondre({ ok: true }));
    await expect(appelerOptimisation('/x', {}, z.object({ ok: z.boolean() }))).resolves.toEqual({ ok: true });
  });
});
