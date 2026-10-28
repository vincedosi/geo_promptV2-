import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * `GET /api/map/catalogue/fiche` — la fiche d'un référentiel ne lit que les sources des indicateurs DE ce référentiel
 * (lot « Catalogue et groupes », relecture T1-T3 n° 4 et observation A de la re-relecture).
 *
 * Avant le correctif, la route lisait la source de TOUS les indicateurs visibles : le jour où un second indicateur
 * privable reçoit une source sans figurer dans `civique:indicateurs-cp.indicateurs`, sa source serait apparue dans la
 * fiche civique. Tant qu'un seul indicateur est privable, aucun test d'intégration ne peut le voir : on le verrouille
 * ici en simulant un second indicateur visible et sourcé.
 */
const idsLus: string[][] = [];

vi.mock('@/lib/api/middleware', () => ({
  requireAuth: async () => ({ id: 'u1', role: 'client', organization_id: 'org-bercy' }),
  authUnauthorized: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/auth/getSessionOrg', () => ({ getSessionOrg: async () => ({ orgId: 'org-bercy' }) }));
vi.mock('@/lib/auth/getOrgSourceIds', () => ({ getOrgSourceIds: async () => [] }));
vi.mock('@/lib/espaces/lister-espaces', () => ({ lireEspacesBruts: async () => [] }));
vi.mock('@/lib/espaces/nom-espace', () => ({ nomAffiche: () => 'Bercy' }));
vi.mock('@/lib/auth/perimetre-donnees', () => ({
  indicateursVisiblesDeLaSession: async () => ({
    visibles: new Set(['abstention_pres_2022', 'autre_indicateur_prive']),
    propres: new Set(['abstention_pres_2022', 'autre_indicateur_prive']),
    sourceDe: new Map([['abstention_pres_2022', 'src-abstention'], ['autre_indicateur_prive', 'src-etrangere']]),
    echec: false,
  }),
}));
vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    from: () => {
      const c = {
        select: () => c,
        in: (_col: string, ids: string[]) => { idsLus.push(ids); return c; },
        eq: () => c,
        then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
      };
      return c;
    },
  }),
}));

const { GET } = await import('@/app/api/map/catalogue/fiche/route');
const appeler = (cle: string) => GET(new NextRequest(`http://localhost/api/map/catalogue/fiche?cle=${encodeURIComponent(cle)}`));

beforeEach(() => { idsLus.length = 0; });

describe('GET /api/map/catalogue/fiche — sources d un référentiel', () => {
  it('civique : seule la source de l abstention est lue, pas celle d un autre indicateur visible', async () => {
    await appeler('civique:indicateurs-cp');
    expect(idsLus).toEqual([['src-abstention']]);
  });

  it('référentiel sans indicateur : aucune source lue', async () => {
    const r = await appeler('carreaux:filosofi');
    expect(idsLus).toEqual([[]]);
    expect(r.status).toBe(200);
  });
});
