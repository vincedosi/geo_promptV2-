/**
 * `GET /api/bidding/strategies/[id]/export` — branche NATIONALE.
 *
 * Une stratégie nationale lit toute la variable dans `indicator_cp_values`
 * par pages de 1 000 (`.range()`). Jusqu'au 2026-10-11 ces pages n'étaient
 * pas triées : sans `ORDER BY`, PostgreSQL ne promet aucun ordre entre deux
 * requêtes, et un décalage (`OFFSET`) sur un ordre qui change d'une requête à
 * l'autre rend des pages qui se recouvrent et des trous — des codes postaux
 * absents du fichier custom bidding, sans erreur.
 *
 * Le faux client rend, SANS tri demandé, un ordre différent à chaque requête
 * (comme un parcours séquentiel concurrent ou un plan qui change) ; AVEC
 * `.order(...)`, l'ordre trié sur la colonne. Le plafond de 1 000 lignes par
 * requête (`db-max-rows`) est reproduit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const MAX_ROWS = 1000;
let valeurs: { postal_code: string; value: number }[] = [];
let appels = 0;
const ordres: (string | null)[] = [];

function constructeur(table: string) {
  let de = 0;
  let a = Number.POSITIVE_INFINITY;
  let ordre: string | null = null;
  let unique = false;
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.eq = () => c;
  c.in = () => c;
  c.order = (col: string) => { ordre = col; return c; };
  c.range = (x: number, y: number) => { de = x; a = y; return c; };
  c.limit = (n: number) => { a = de + n - 1; return c; };
  c.single = () => { unique = true; return c; };
  c.maybeSingle = c.single;
  c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
    let reponse: unknown;
    if (unique && table === 'bidding_strategies') {
      reponse = {
        data: {
          id: 's', name: 'Strategie nationale', scope_type: 'national', zone_id: null,
          weighting_mode: 'by_insee_variable',
          in_zone_weights: { variable_code: 'abstention_pres_2022', curve: [{ x: 0, y: 1 }, { x: 100, y: 2 }] },
          out_zone_weights: { mode: 'uniform', value: 1 },
        },
        error: null,
      };
    } else if (unique && table === 'dsp_channel_registry') {
      reponse = { data: { code: 'autre', label: 'Autre', category: 'x', connection_provider: 'autre' }, error: null };
    } else if (table === 'indicator_cp_values') {
      ordres.push(ordre);
      let lignes = [...valeurs];
      if (ordre) {
        lignes.sort((x, y) => String(x[ordre as 'postal_code']).localeCompare(String(y[ordre as 'postal_code'])));
      } else {
        // Sans tri : un ordre qui change d'une requête à l'autre.
        appels += 1;
        const decalage = (appels * 377) % lignes.length;
        lignes = [...lignes.slice(decalage), ...lignes.slice(0, decalage)];
      }
      const fin = Math.min(a + 1, de + MAX_ROWS, lignes.length);
      reponse = { data: lignes.slice(de, Math.max(de, fin)), error: null };
    } else {
      reponse = { data: [], error: null };
    }
    return Promise.resolve(reponse).then(ok, ko);
  };
  return c;
}

vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({ from: (table: string) => constructeur(table) }),
}));
vi.mock('@/lib/api/middleware', () => ({
  requireAuth: async () => ({ id: 'u', organization_id: 'o' }),
  authUnauthorized: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/campaigns/access', () => ({
  checkStrategyAccess: async () => 'ok',
}));

const { GET } = await import('@/app/api/bidding/strategies/[id]/export/route');

beforeEach(() => {
  appels = 0;
  ordres.length = 0;
});

describe('export d une stratégie nationale', () => {
  it('2 500 codes postaux en base : les 2 500 dans le fichier, chacun une fois', async () => {
    valeurs = Array.from({ length: 2500 }, (_, i) => ({ postal_code: String(10000 + i), value: i % 100 }));
    const res = await GET(
      new NextRequest('http://localhost/api/bidding/strategies/s/export?channel=autre'),
      { params: Promise.resolve({ id: 's' }) },
    );
    expect(res.status).toBe(200);
    const codes = (await res.text()).split('\n').filter((l) => /^\d/.test(l)).map((l) => l.split(/[;,]/)[0]);
    expect(new Set(codes).size).toBe(2500);
    expect(codes).toHaveLength(2500);
  });

  it('chaque page est triée sur la clé (postal_code, unique pour un indicateur)', async () => {
    valeurs = Array.from({ length: 2500 }, (_, i) => ({ postal_code: String(10000 + i), value: 1 }));
    await GET(
      new NextRequest('http://localhost/api/bidding/strategies/s/export?channel=autre'),
      { params: Promise.resolve({ id: 's' }) },
    );
    expect(ordres.length).toBeGreaterThanOrEqual(3);
    for (const o of ordres) expect(o).toBe('postal_code');
  });
});
