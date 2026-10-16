/**
 * `POST /api/bidding/strategies` et `GET /api/bidding/strategies/[id]` sans
 * l'agent d'enchères (lot 2 du chantier « suppression de toute l'IA »).
 *
 * L'agent autonome lisait et écrivait `agent_autonomy_settings` : un niveau
 * d'autonomie par stratégie, posé à la création (`agent_autonomy_override`)
 * et relu à la lecture. L'agent supprimé, ce réglage ne commande plus rien.
 * Ce test verrouille que la création et la lecture d'une stratégie restent
 * IDENTIQUES hors ce seul champ : même statut, mêmes clés de réponse, mêmes
 * écritures — et plus aucun accès à `agent_autonomy_settings`.
 *
 * `active_model` (table `adaptive_model_state`, le modèle ML entraîné par
 * Modal) a été retiré de la lecture au lot 3 : aucun écran ne le lisait, et
 * « plus rien d'IA dans le code ». La table reste en base (liste remise au
 * propriétaire en fin de chantier) ; la route ne la lit plus.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const tablesTouchees: string[] = [];
const rpcAppelees: string[] = [];

function constructeur(table: string) {
  tablesTouchees.push(table);
  let unique = false;
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'insert', 'update', 'upsert', 'range']) {
    c[m] = () => c;
  }
  c.single = () => { unique = true; return c; };
  c.maybeSingle = c.single;
  c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
    let reponse: unknown = { data: unique ? null : [], error: null };
    if (unique && table === 'bidding_strategies') {
      reponse = {
        data: {
          id: 'strat-1', name: 'S', campaign_id: 'camp-1', objective_code: 'ctr',
          scope_type: 'national', zone_id: null, weighting_mode: 'uniform',
          status: 'draft', created_at: '2026-10-12',
        },
        error: null,
      };
    } else if (unique && table === 'dsp_campaigns') {
      reponse = { data: { id: 'camp-1', name: 'C', dsp_source: 'dv360', is_demo: false }, error: null };
    } else if (unique && table === 'agent_autonomy_settings') {
      reponse = { data: { autonomy_level: 3 }, error: null };
    }
    return Promise.resolve(reponse).then(ok, ko);
  };
  return c;
}

vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    from: (table: string) => constructeur(table),
    rpc: async (nom: string) => { rpcAppelees.push(nom); return { data: 4, error: null }; },
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

const { POST } = await import('@/app/api/bidding/strategies/route');
const { GET } = await import('@/app/api/bidding/strategies/[id]/route');

beforeEach(() => {
  tablesTouchees.length = 0;
  rpcAppelees.length = 0;
});

describe('stratégie d enchères sans l agent autonome', () => {
  it('création : 201, même réponse, sans écrire agent_autonomy_settings même si le champ est envoyé', async () => {
    const res = await POST(new NextRequest('http://localhost/api/bidding/strategies', {
      method: 'POST',
      body: JSON.stringify({
        campaign_id: '11111111-1111-4111-8111-111111111111',
        name: 'S',
        scope_type: 'national',
        algorithm_code: 'static',
        objective_code: 'ctr',
        agent_autonomy_override: 3,
      }),
    }));
    expect(res.status).toBe(201);
    const corps = await res.json();
    expect(Object.keys(corps).sort()).toEqual(['n_zone_configs_created', 'strategy']);
    expect(corps.n_zone_configs_created).toBe(4);
    expect(tablesTouchees).toContain('bidding_strategies');
    expect(tablesTouchees).not.toContain('agent_autonomy_settings');
    expect(rpcAppelees).toEqual(['apply_zone_weights_to_strategy', 'log_strategy_change', 'refresh_campaign_rollups']);
  });

  it('lecture : mêmes clés moins agent_autonomy_override et active_model, sans lire les tables de l agent ni du ML', async () => {
    const res = await GET(
      new NextRequest('http://localhost/api/bidding/strategies/strat-1'),
      { params: Promise.resolve({ id: 'strat-1' }) },
    );
    expect(res.status).toBe(200);
    const corps = await res.json();
    expect(Object.keys(corps).sort()).toEqual(['campaign', 'objective', 'strategy', 'subzones']);
    expect(corps.strategy.id).toBe('strat-1');
    expect(tablesTouchees).not.toContain('agent_autonomy_settings');
    expect(tablesTouchees).not.toContain('adaptive_model_state');
    expect(tablesTouchees).toEqual(expect.arrayContaining(['bidding_strategies', 'dsp_campaigns', 'bidding_objectives', 'bidding_strategy_subzones']));
  });
});
