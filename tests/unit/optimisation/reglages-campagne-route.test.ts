/**
 * `GET` / `PUT /api/campaigns/[campaignId]/optimisation/reglages` (relecture de la phase 2, I3) : passerelle vers
 * `/v1/campagnes/{id}/reglages`. Vérifie les droits (ceux de l'algorithme), l'identité transmise, le relais des refus
 * 422 en français, et la RECONSTRUCTION des tableaux par CP quand `tableaux_depuis_plan` change — et seulement alors.
 * Base et `fetch` simulés.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const CAMPAGNE = 'dccc0000-0000-4000-8000-000000000002';
const PROPRIETAIRE = '00000000-0000-0000-0000-000000000001';
const PARTENAIRE = '22222222-0000-4000-8000-000000000002';
const ETRANGER = '83cae295-9239-44b5-bb12-7a8b23448b01';
const CLE = 'cle-de-test-sans-valeur';

let profil: { id: string; role: string; organization_id: string | null } | null;
let erreurRefresh: { message: string } | null = null;
const rpc = vi.fn(async (_nom: string, _args: unknown) =>
  ({ data: erreurRefresh ? null : { cp_rows: 10293, cp_non_servis: 88 }, error: erreurRefresh }));

vi.mock('@/lib/api/middleware', () => ({
  requireAuth: async () => profil,
  authUnauthorized: () => new Response(JSON.stringify({ error: 'Authentification requise.' }), { status: 401 }),
}));

vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    rpc,
    from: (table: string) => ({
      select: () => ({
        eq: () => table === 'dsp_campaigns'
          ? { maybeSingle: async () => ({ data: { organization_id: PROPRIETAIRE }, error: null }) }
          : Promise.resolve({ data: [{ organization_id: PROPRIETAIRE }, { organization_id: PARTENAIRE }], error: null }),
      }),
    }),
  }),
}));

const { GET, PUT } = await import('@/app/api/campaigns/[campaignId]/optimisation/reglages/route');

const SEUILS = {
  rythme_retard: 0.85, rythme_retard_grave: 0.7, rythme_avance: 1.15, rythme_avance_grave: 1.3,
  cpm_depassement: 1.25, cp_sous_plan_pct: 70, fuite_pct: 5, ecart_signale_pct: 20,
};
const REGLAGES = (parametres: Record<string, unknown>, depuisPlan: boolean) => ({
  campagne_id: CAMPAGNE, parametres,
  effectifs: { seuils: SEUILS, tableaux_depuis_plan: depuisPlan, univers_methode_a: 'fige' },
  enregistre: Object.keys(parametres).length > 0, maj_par: null, maj_le: null,
});
const ENTREE = {
  id: 'e1', modifie_par: 'u-prop', role_auteur: 'client', modifie_le: '2026-11-05T09:30:00Z',
  avant: {}, apres: { tableaux_depuis_plan: true },
};

const repondre = (corps: unknown, status = 200) =>
  vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify(corps), { status, headers: { 'Content-Type': 'application/json' } }));

const contexte = () => ({ params: Promise.resolve({ campaignId: CAMPAGNE }) });
const url = `http://localhost/api/campaigns/${CAMPAGNE}/optimisation/reglages`;
const lire = () => GET(new NextRequest(url), contexte());
const regler = (corps: unknown) => PUT(new NextRequest(url, { method: 'PUT', body: JSON.stringify(corps) }), contexte());

beforeEach(() => {
  profil = { id: 'u-prop', role: 'client', organization_id: PROPRIETAIRE };
  erreurRefresh = null;
  rpc.mockClear();
  vi.stubEnv('OPTIMISATION_URL', 'http://127.0.0.1:8090');
  vi.stubEnv('OPTIMISATION_CLE_INTERNE', CLE);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('GET …/optimisation/reglages', () => {
  it('relaie les réglages, X-Espace = propriétaire, peut_regler', async () => {
    const f = repondre({ reglages: REGLAGES({}, false), journal: [], journal_tronque: false });
    vi.stubGlobal('fetch', f);
    const r = await lire();
    expect(r.status).toBe(200);
    expect((await r.json()).peut_regler).toBe(true);
    expect(f.mock.calls[0]?.[0]).toBe(`http://127.0.0.1:8090/v1/campagnes/${CAMPAGNE}/reglages`);
    expect((f.mock.calls[0]?.[1]?.headers as Record<string, string>)['X-Espace']).toBe(PROPRIETAIRE);
  });

  it('autre espace : 404, aucun appel', async () => {
    profil = { id: 'u-etr', role: 'admin', organization_id: ETRANGER };
    const f = repondre({});
    vi.stubGlobal('fetch', f);
    expect((await lire()).status).toBe(404);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('PUT …/optimisation/reglages', () => {
  it('bascule allumée : transmet, puis reconstruit les tableaux par CP', async () => {
    const f = repondre({
      reglages: REGLAGES({ tableaux_depuis_plan: true }, true), change: true, entree: ENTREE, tableaux_a_reconstruire: true,
    });
    vi.stubGlobal('fetch', f);
    const r = await regler({ parametres: { tableaux_depuis_plan: true } });
    expect(r.status).toBe(200);
    const corps = await r.json();
    expect(corps.reconstruction).toEqual({ ok: true, cp_rows: 10293, cp_non_servis: 88 });
    expect(JSON.parse(String(f.mock.calls[0]?.[1]?.body))).toEqual({ parametres: { tableaux_depuis_plan: true } });
    expect(f.mock.calls[0]?.[1]?.headers).toMatchObject({ 'X-Espace': PROPRIETAIRE, 'X-Utilisateur': 'u-prop', 'X-Role': 'client' });
    expect(rpc).toHaveBeenCalledWith('refresh_campaign_rollups', { p_campaign_id: CAMPAGNE });
  });

  it('seuil seul : aucune reconstruction', async () => {
    vi.stubGlobal('fetch', repondre({
      reglages: REGLAGES({ seuils: { cp_sous_plan_pct: 50 } }, false), change: true, entree: ENTREE,
      tableaux_a_reconstruire: false,
    }));
    const r = await regler({ parametres: { seuils: { cp_sous_plan_pct: 50 } } });
    expect((await r.json()).reconstruction).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reconstruction en échec : réglage gardé, échec rendu sans message Postgres', async () => {
    erreurRefresh = { message: 'relation "campaign_cp_rollup" …' };
    vi.stubGlobal('fetch', repondre({
      reglages: REGLAGES({ tableaux_depuis_plan: true }, true), change: true, entree: ENTREE, tableaux_a_reconstruire: true,
    }));
    const corps = await (await regler({ parametres: { tableaux_depuis_plan: true } })).json();
    expect(corps.change).toBe(true);
    expect(corps.reconstruction.ok).toBe(false);
    expect(JSON.stringify(corps)).not.toContain('campaign_cp_rollup');
  });

  it('refus 422 du service relayé en français, aucune reconstruction', async () => {
    vi.stubGlobal('fetch', repondre({
      detail: { refus: 'parametre_invalide', message: '« seuils.cp_sous_plan_pct » ne peut pas dépasser 100.' },
    }, 422));
    const r = await regler({ parametres: { seuils: { cp_sous_plan_pct: 150 } } });
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({
      error: 'parametre_invalide', message: '« seuils.cp_sous_plan_pct » ne peut pas dépasser 100.',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('espace partagé : 403 ; corps mal formé : 400 ; aucun appel', async () => {
    const f = repondre({});
    vi.stubGlobal('fetch', f);
    profil = { id: 'u-part', role: 'admin', organization_id: PARTENAIRE };
    expect((await regler({ parametres: {} })).status).toBe(403);
    profil = { id: 'u-prop', role: 'client', organization_id: PROPRIETAIRE };
    expect((await regler({ parametres: [] })).status).toBe(400);
    expect((await regler({ parametres: {}, autre: 1 })).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
});
