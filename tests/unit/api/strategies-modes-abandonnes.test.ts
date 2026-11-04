/**
 * Modes de pondération ABANDONNÉS (05/11) : `by_tier` « par palier » et `by_subzone` « par sous-zone ».
 *
 * `POST /api/bidding/strategies` et `PATCH /api/bidding/strategies/[id]` les refusent — dans `weighting_mode` et dans
 * le `mode` des poids en zone / hors zone — par un 422 `mode_abandonne` au message français, AVANT toute écriture.
 * Les modes vivants passent comme avant ; la lecture d'une stratégie (GET) n'est pas touchée.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const ecritures: string[] = [];
const tables: string[] = [];

function constructeur(table: string) {
  tables.push(table);
  let unique = false;
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'range']) c[m] = () => c;
  for (const m of ['insert', 'update', 'upsert', 'delete']) c[m] = () => { ecritures.push(`${table}.${m}`); return c; };
  c.single = () => { unique = true; return c; };
  c.maybeSingle = c.single;
  c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
    let reponse: unknown = { data: unique ? null : [], error: null };
    if (unique && table === 'bidding_strategies') {
      reponse = {
        data: {
          id: 'strat-1', name: 'S', campaign_id: 'camp-1', objective_code: 'ctr', scope_type: 'national',
          zone_id: null, weighting_mode: 'uniform', in_zone_weights: {}, out_zone_weights: {}, status: 'draft',
          created_at: '2026-11-04',
        },
        error: null,
      };
    } else if (unique && table === 'dsp_campaigns') {
      reponse = { data: { id: 'camp-1', name: 'C', dsp_source: 'dv360', is_demo: false }, error: null };
    }
    return Promise.resolve(reponse).then(ok, ko);
  };
  return c;
}

vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    from: (table: string) => constructeur(table),
    rpc: async (nom: string) => { ecritures.push(`rpc.${nom}`); return { data: 4, error: null }; },
  }),
}));
vi.mock('@/lib/api/middleware', () => ({
  requireAuth: async () => ({ id: 'u', role: 'super_admin', organization_id: 'o' }),
  authUnauthorized: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/campaigns/access', () => ({
  checkCampaignAccess: async () => 'ok',
  checkStrategyAccess: async () => 'ok',
  checkZoneAccess: async () => 'ok',
}));
vi.mock('@/lib/auth/perimetre-donnees', () => ({
  indicateursVisibles: async () => ({ visibles: new Set<string>() }),
}));

const { POST } = await import('@/app/api/bidding/strategies/route');
const { PATCH, GET } = await import('@/app/api/bidding/strategies/[id]/route');

const CREATION = {
  campaign_id: '11111111-1111-4111-8111-111111111111',
  name: 'Stratégie',
  scope_type: 'national',
  algorithm_code: 'a',
  objective_code: 'ctr',
};

const creer = (corps: Record<string, unknown>) => POST(new NextRequest('http://localhost/api/bidding/strategies', {
  method: 'POST', body: JSON.stringify({ ...CREATION, ...corps }),
}));
const modifier = (corps: Record<string, unknown>) => PATCH(
  new NextRequest('http://localhost/api/bidding/strategies/strat-1', { method: 'PATCH', body: JSON.stringify(corps) }),
  { params: Promise.resolve({ id: 'strat-1' }) },
);

beforeEach(() => {
  ecritures.length = 0;
  tables.length = 0;
});

const CAS: [string, Record<string, unknown>, string, string][] = [
  ['weighting_mode by_tier', { weighting_mode: 'by_tier' }, 'weighting_mode', 'par palier'],
  ['weighting_mode by_subzone', { weighting_mode: 'by_subzone' }, 'weighting_mode', 'par sous-zone'],
  ['poids en zone by_subzone', { in_zone_weights: { mode: 'by_subzone' } }, 'in_zone_weights.mode', 'par sous-zone'],
  ['poids hors zone by_tier', { out_zone_weights: { mode: 'by_tier' } }, 'out_zone_weights.mode', 'par palier'],
];

describe('modes de pondération abandonnés', () => {
  it.each(CAS)('création refusée — %s : 422 français, aucune écriture', async (_nom, corps, champ, libelle) => {
    const res = await creer(corps);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('mode_abandonne');
    expect(json.champ).toBe(champ);
    expect(json.detail).toBe(
      `Mode de pondération « ${libelle} » abandonné : il n'est plus calculé. `
      + 'Choisissez une pondération par donnée INSEE, uniforme ou par liste de codes postaux.',
    );
    expect(ecritures).toEqual([]);
    expect(tables).toEqual([]);
  });

  it.each(CAS)('modification refusée — %s : 422 français, aucune lecture ni écriture', async (_nom, corps, champ) => {
    const res = await modifier(corps);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('mode_abandonne');
    expect(json.champ).toBe(champ);
    expect(ecritures).toEqual([]);
    expect(tables).toEqual([]);
  });

  it.each(['uniform', 'by_cp_csv', 'by_insee_variable'])('mode vivant %s : création acceptée (201)', async (mode) => {
    const res = await creer({ weighting_mode: mode });
    expect(res.status).toBe(201);
    expect(ecritures).toContain('bidding_strategies.insert');
  });

  it('un autre champ invalide garde l’ancienne réponse 400 invalid_body', async () => {
    const res = await creer({ scope_type: 'monde' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_body');
  });

  it('modification sans mode abandonné : passe la validation (pas de 422)', async () => {
    const res = await modifier({ name: 'Renommée' });
    expect(res.status).not.toBe(422);
  });

  it('lecture d’une stratégie : inchangée (200)', async () => {
    const res = await GET(new NextRequest('http://localhost/api/bidding/strategies/strat-1'),
      { params: Promise.resolve({ id: 'strat-1' }) });
    expect(res.status).toBe(200);
  });
});
