/**
 * POST /api/analyses/score — la règle des codes postaux d'une zone (④ finitions, T1, arbitrages A-1 et A-2).
 *
 * Une zone se résout par `codes_postaux_de_zone_jsonb` (sql/295), la règle de la couverture « Par code postal » : plus
 * jamais par la branche `zone` de `codes_postaux_du_perimetre_jsonb`. L'espace est contrôlé EN SQL (`p_org` = l'espace
 * de la session) : un id d'un autre espace répond 404 `zone_introuvable`, la phrase unique du lot 4. Les autres formes
 * de périmètre (filtre région / département / commune / CP / France, bbox, liste) sont inchangées.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const ZONE = '3f2a6c1e-8a4b-4c3d-9e5f-1a2b3c4d5e6f';
const ESPACE = '11111111-1111-4111-8111-111111111111';

let appels: { nom: string; args: Record<string, unknown> }[] = [];
let reponseZone: unknown = { codes: ['16270', '16450'] };
const checkZoneAccess = vi.fn(async () => 'ok');

vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    rpc: async (nom: string, args: Record<string, unknown>) => {
      appels.push({ nom, args });
      if (nom === 'codes_postaux_de_zone_jsonb') return { data: reponseZone, error: null };
      if (nom === 'codes_postaux_du_perimetre_jsonb') return { data: ['13001', '13002'], error: null };
      if (nom === 'codes_postaux_dans_bbox_jsonb') return { data: ['75001'], error: null };
      if (nom === 'calculer_score_composite_jsonb') {
        const cps = args.p_codes_postaux as string[];
        return { data: cps.map((code) => ({ postal_code: code, score: 50, n_indicateurs: 1 })), error: null };
      }
      return { data: null, error: { message: `rpc inattendue ${nom}` } };
    },
    from: () => ({
      select: () => ({
        in: () => ({ eq: async () => ({ data: [{ indicator_code: 'rev_median', label: 'Revenu médian', unit: '€' }], error: null }) }),
      }),
    }),
  }),
}));
vi.mock('@/lib/api/middleware', () => ({
  requireAuth: async () => ({ id: 'u', role: 'client', organization_id: ESPACE }),
  authUnauthorized: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/api/rate-limit', () => ({
  createRateLimiter: () => async () => ({ ok: true }),
  createQuota: () => async () => null,
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));
vi.mock('@/lib/auth/perimetre-donnees', () => ({
  indicateursVisibles: async () => ({ visibles: { has: () => true }, propres: new Set() }),
}));
vi.mock('@/lib/analyses/indicateurs', () => ({ assurerIndicateurCp: async () => ({ ok: true, calculeLe: null }) }));
vi.mock('@/lib/campaigns/access', () => ({ checkZoneAccess }));

const { POST } = await import('@/app/api/analyses/score/route');

function appel(perimetre: Record<string, unknown>) {
  return POST(new NextRequest('http://localhost/api/analyses/score', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ indicateurs: [{ code: 'rev_median', poids: 1, sens: 'croissant' }], enregistrer: false, ...perimetre }),
  }));
}

beforeEach(() => {
  appels = [];
  reponseZone = { codes: ['16270', '16450'] };
  checkZoneAccess.mockClear();
});

describe('POST /api/analyses/score — périmètre `zone` (sql/295)', () => {
  it('appelle codes_postaux_de_zone_jsonb avec l’espace de la session, jamais la branche zone de codes_postaux_du_perimetre_jsonb', async () => {
    const res = await appel({ perimetre: { type: 'zone', code: ZONE } });
    expect(res.status).toBe(200);
    expect(appels[0]).toEqual({ nom: 'codes_postaux_de_zone_jsonb', args: { p_zone: ZONE, p_org: ESPACE } });
    expect(appels.map((a) => a.nom)).not.toContain('codes_postaux_du_perimetre_jsonb');
    const corps = await res.json();
    expect(corps.scores.map((s: { code: string }) => s.code)).toEqual(['16270', '16450']);
    expect(corps.perimetre.n_codes_postaux).toBe(2);
  });

  it('l’espace est contrôlé en SQL : plus de lecture `checkZoneAccess` à côté', async () => {
    await appel({ perimetre: { type: 'zone', code: ZONE } });
    expect(checkZoneAccess).not.toHaveBeenCalled();
  });

  it('zone absente ou d’un autre espace → 404 `zone_introuvable`, la phrase unique, sans calcul', async () => {
    reponseZone = { refus: 'zone_introuvable' };
    const res = await appel({ perimetre: { type: 'zone', code: ZONE } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Zone introuvable dans cet espace.', refus: 'zone_introuvable' });
    expect(appels.map((a) => a.nom)).toEqual(['codes_postaux_de_zone_jsonb']);
  });

  it('id illisible → 404 `zone_introuvable` sans rien lire en base', async () => {
    const res = await appel({ perimetre: { type: 'zone', code: 'pas-un-uuid' } });
    expect(res.status).toBe(404);
    expect((await res.json()).refus).toBe('zone_introuvable');
    expect(appels).toEqual([]);
  });

  it('zone de plus de 100 000 km² → 422 `zone_trop_vaste`, avec ses chiffres', async () => {
    reponseZone = { refus: 'zone_trop_vaste', surface_km2: 180000.5, plafond_km2: 100000 };
    const res = await appel({ perimetre: { type: 'zone', code: ZONE } });
    expect(res.status).toBe(422);
    const corps = await res.json();
    expect(corps.refus).toBe('zone_trop_vaste');
    expect(corps.plafond_km2).toBe(100000);
    expect(typeof corps.error).toBe('string');
  });

  it('base non certifiée → 503 `couverture_non_construite`', async () => {
    reponseZone = { refus: 'couverture_non_construite', motif: 'incomplete' };
    const res = await appel({ perimetre: { type: 'zone', code: ZONE } });
    expect(res.status).toBe(503);
    expect((await res.json()).motif).toBe('incomplete');
  });

  it('zone sans habitant → 400 « Périmètre vide », comme avant', async () => {
    reponseZone = { codes: [] };
    const res = await appel({ perimetre: { type: 'zone', code: ZONE } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Périmètre vide : aucun code postal à scorer.');
  });

  it('réponse hors contrat → 500, journalisée', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reponseZone = { refus: 'inconnu' };
    const res = await appel({ perimetre: { type: 'zone', code: ZONE } });
    expect(res.status).toBe(500);
  });
});

describe('POST /api/analyses/score — les autres périmètres sont inchangés', () => {
  it.each(['region', 'departement', 'commune', 'cp', 'france'])('filtre `%s` → codes_postaux_du_perimetre_jsonb, mêmes arguments', async (type) => {
    const res = await appel({ perimetre: { type, code: '13' } });
    expect(res.status).toBe(200);
    expect(appels[0]).toEqual({ nom: 'codes_postaux_du_perimetre_jsonb', args: { p_type: type, p_code: '13' } });
    expect((await res.json()).perimetre).toEqual({ n_codes_postaux: 2, n_scores: 2, n_complets: 2 });
  });

  it('bbox → codes_postaux_dans_bbox_jsonb', async () => {
    const res = await appel({ bbox: [2, 48, 3, 49] });
    expect(res.status).toBe(200);
    expect(appels[0]).toEqual({ nom: 'codes_postaux_dans_bbox_jsonb', args: { p_ouest: 2, p_sud: 48, p_est: 3, p_nord: 49 } });
  });

  it('liste explicite → aucune résolution', async () => {
    const res = await appel({ codes_postaux: ['69001'] });
    expect(res.status).toBe(200);
    expect(appels.map((a) => a.nom)).toEqual(['calculer_score_composite_jsonb']);
  });

  it('réponse de succès : mêmes clés qu’avant', async () => {
    const corps = await (await appel({ perimetre: { type: 'departement', code: '13' } })).json();
    expect(Object.keys(corps)).toEqual(['scores', 'indicateurs', 'perimetre', 'analyse_id']);
    expect(corps.scores[0]).toEqual({ code: '13001', score: 50, n_indicateurs: 1 });
  });
});
