/**
 * `GET /api/optimisation/algos` (tâche 2.6) : passerelle vers `GET /v1/algos` du service — session exigée, filtres
 * validés, réponse relayée telle quelle après Zod, défaillances du service jamais masquées. `fetch` simulé.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

let connecte = true;
vi.mock('@/lib/api/middleware', () => ({
  requireAuth: async () => (connecte ? { id: 'u', role: 'client', organization_id: 'o' } : null),
  authUnauthorized: () => new Response(JSON.stringify({ error: 'Authentification requise.' }), { status: 401 }),
}));

const { GET } = await import('@/app/api/optimisation/algos/route');

const CLE = 'cle-de-test-sans-valeur';
const PARAM = { nom: 'alpha', libelle: 'Force de la correction (α)', defaut: 0.5, minimum: 0.1, maximum: 1, unite: '', entier: false };
const GLOBAL = {
  id: 'uniformiser_global', version: 1, libelle: 'Uniformiser au global', description: 'Le poids de chaque zone…',
  familles: ['correction'], proposable: true, etat: 'a_venir', parametres: [PARAM],
  ordres: [['coefficient_min', 'coefficient_max']],
};
const CATALOGUE = { algos: [GLOBAL], defaut_correction: 'uniformiser_global' };

const repondre = (corps: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(corps), { status, headers: { 'Content-Type': 'application/json' } }));

const appeler = (requete = '') => GET(new NextRequest(`http://localhost/api/optimisation/algos${requete}`));

beforeEach(() => {
  connecte = true;
  vi.stubEnv('OPTIMISATION_URL', 'http://127.0.0.1:8090');
  vi.stubEnv('OPTIMISATION_CLE_INTERNE', CLE);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('GET /api/optimisation/algos', () => {
  it('sans session : 401, le service n’est pas appelé', async () => {
    connecte = false;
    const f = repondre(CATALOGUE);
    vi.stubGlobal('fetch', f);
    expect((await appeler()).status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });

  it('relaie le catalogue tel quel : GET sans corps, clé interne, clés inconnues gardées', async () => {
    const f = repondre({ ...CATALOGUE, nouveau: 1 });
    vi.stubGlobal('fetch', f);
    const res = await appeler();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...CATALOGUE, nouveau: 1 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8090/v1/algos');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)['X-Optimisation-Cle']).toBe(CLE);
  });

  it('transmet les filtres famille et proposable', async () => {
    const f = repondre(CATALOGUE);
    vi.stubGlobal('fetch', f);
    expect((await appeler('?famille=correction&proposable=true')).status).toBe(200);
    expect((f.mock.calls[0] as unknown as [string])[0])
      .toBe('http://127.0.0.1:8090/v1/algos?famille=correction&proposable=true');
  });

  it.each([
    ['?famille=enchere', 'Famille inconnue'],
    ['?proposable=oui', 'Proposable'],
    ['?tri=id', 'Paramètre inconnu : tri.'],
  ])('filtre invalide %s : 400 en français, le service n’est pas appelé', async (requete, morceau) => {
    const f = repondre(CATALOGUE);
    vi.stubGlobal('fetch', f);
    const res = await appeler(requete);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(morceau);
    expect(f).not.toHaveBeenCalled();
  });

  it('réponse d’une autre forme : 502, jamais relayée', async () => {
    vi.stubGlobal('fetch', repondre({ algos: [{ ...GLOBAL, etat: 'peut-etre' }], defaut_correction: 'x' }));
    const res = await appeler();
    expect(res.status).toBe(502);
    const corps = await res.json();
    expect(corps.motif).toBe('reponse');
    expect(corps.error).toMatch(/^Réponse du service d'optimisation illisible/);
  });

  it('service indisponible : 503 avec son message ; injoignable : 503 ; non configuré : 503', async () => {
    vi.stubGlobal('fetch', repondre({ detail: { message: 'Base illisible.' } }, 503));
    let res = await appeler();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('Base illisible.');

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    res = await appeler();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("Le service d'optimisation est injoignable.");

    vi.stubEnv('OPTIMISATION_URL', '');
    res = await appeler();
    expect(res.status).toBe(503);
    expect((await res.json()).motif).toBe('configuration');
  });
});
