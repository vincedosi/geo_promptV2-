/**
 * `GET /api/bidding/strategies` — la liste SANS `?campaign_id=` est lue en entier par `lireTout` (lot 6,
 * relecture 2, I-2). Elle nourrit la partition du hall (React et ⑥) : tronquée en silence à 1 000 lignes
 * (`db-max-rows`), elle classerait une campagne lancée en « coquille » et lui offrirait « Supprimer ».
 *
 * Verrouille : la pagination (pages de 1 000 jusqu'à la page incomplète), le périmètre inchangé (super_admin : toutes
 * les organisations ; sinon les campagnes de l'espace), l'échec dit au-delà du plafond, et le chemin `?campaign_id=`
 * resté à UNE ligne sans pagination.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  role: 'super_admin' as string,
  /** Nombre total de stratégies que la « table » porte. */
  total: 0,
  appels: [] as Array<{ table: string; range?: [number, number]; limit?: number; in?: string[]; eq?: string }>,
}));

function constructeur(table: string) {
  const appel: (typeof h.appels)[number] = { table };
  h.appels.push(appel);
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'order']) c[m] = () => c;
  c.in = (_: string, v: string[]) => { appel.in = v; return c; };
  c.eq = (col: string, v: string) => { appel.eq = `${col}=${v}`; return c; };
  c.limit = (n: number) => { appel.limit = n; return c; };
  c.range = (de: number, a: number) => { appel.range = [de, a]; return c; };
  c.then = (ok: (v: unknown) => unknown) => {
    if (table === 'dsp_campaigns') return Promise.resolve({ data: [{ id: 'c1' }], error: null }).then(ok);
    if (table === 'campaign_organizations') return Promise.resolve({ data: [{ campaign_id: 'c2' }], error: null }).then(ok);
    const [de, a] = appel.range ?? [0, (appel.limit ?? h.total) - 1];
    const n = Math.max(0, Math.min(a, h.total - 1) - de + 1);
    return Promise.resolve({ data: Array.from({ length: n }, (_, i) => ({ id: `s${de + i}` })), error: null }).then(ok);
  };
  return c;
}

vi.mock('@/lib/auth', () => ({ createAdminClient: () => ({ from: (t: string) => constructeur(t) }) }));
vi.mock('@/lib/api/middleware', () => ({
  requireAuth: async () => ({ id: 'u', role: h.role, organization_id: 'o' }),
  authUnauthorized: () => new Response(null, { status: 401 }),
}));

const { GET } = await import('@/app/api/bidding/strategies/route');
const lire = (q = '') => GET(new NextRequest(`http://localhost/api/bidding/strategies${q}`));
const lecturesStrategies = () => h.appels.filter((a) => a.table === 'bidding_strategies');

beforeEach(() => {
  h.role = 'super_admin';
  h.total = 0;
  h.appels.length = 0;
});

describe('GET /api/bidding/strategies — sans campagne, la liste ENTIÈRE', () => {
  it('super_admin, 2 500 stratégies : trois pages, 2 500 lignes rendues (jamais 1 000)', async () => {
    h.total = 2500;
    const r = await lire();
    expect(r.status).toBe(200);
    expect((await r.json()).strategies).toHaveLength(2500);
    expect(lecturesStrategies().map((a) => a.range)).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    // Toutes les organisations : aucun filtre de campagne.
    expect(lecturesStrategies().every((a) => a.in === undefined)).toBe(true);
  });

  it('hors super_admin : le périmètre reste les campagnes de l’espace (propres + liées), paginé lui aussi', async () => {
    h.role = 'client';
    h.total = 3;
    const r = await lire();
    expect((await r.json()).strategies).toHaveLength(3);
    expect(lecturesStrategies()[0]).toMatchObject({ in: ['c1', 'c2'], range: [0, 999] });
  });

  it('au-delà du plafond : 500 qui le DIT, jamais une liste tronquée', async () => {
    h.total = 30_000;
    const r = await lire();
    expect(r.status).toBe(500);
    expect((await r.json()).error).toMatch(/interrompue plutôt que tronquée/);
  });

  it('?campaign_id= : UNE ligne, sans pagination (chemin de ⑥ inchangé)', async () => {
    h.total = 5;
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const r = await lire(`?campaign_id=${id}`);
    expect((await r.json()).strategies).toHaveLength(1);
    expect(lecturesStrategies()).toEqual([{ table: 'bidding_strategies', eq: `campaign_id=${id}`, limit: 1 }]);
  });
});
