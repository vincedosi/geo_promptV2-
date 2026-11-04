/**
 * `GET` / `PUT /api/campaigns/[campaignId]/optimisation/algo` (tâche 2.7) : passerelle vers `/v1/campagnes/{id}/algo`.
 * Vérifie les droits (lire = accès à la campagne, régler = propriétaire ou super_admin, autre espace = 404), l'identité
 * transmise au service (`X-Espace` = espace PROPRIÉTAIRE, `X-Utilisateur`, `X-Role`), le relais des refus 422 en
 * français, et qu'aucun appel au service ne part quand Next refuse. Base et `fetch` simulés.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { resoudreDroitAlgo } from '@/lib/optimisation/droit-algo';

const CAMPAGNE = 'dccc0000-0000-4000-8000-000000000002';
const PROPRIETAIRE = '00000000-0000-0000-0000-000000000001';
const PARTENAIRE = '22222222-0000-4000-8000-000000000002';
const ETRANGER = '83cae295-9239-44b5-bb12-7a8b23448b01';
const CLE = 'cle-de-test-sans-valeur';

let profil: { id: string; role: string; organization_id: string | null } | null;
let campagneExiste = true;

vi.mock('@/lib/api/middleware', () => ({
  requireAuth: async () => profil,
  authUnauthorized: () => new Response(JSON.stringify({ error: 'Authentification requise.' }), { status: 401 }),
}));

vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => table === 'dsp_campaigns'
          ? { maybeSingle: async () => ({ data: campagneExiste ? { organization_id: PROPRIETAIRE } : null, error: null }) }
          : Promise.resolve({
            data: [{ organization_id: PROPRIETAIRE }, { organization_id: PARTENAIRE }], error: null,
          }),
      }),
    }),
  }),
}));

const { GET, PUT } = await import('@/app/api/campaigns/[campaignId]/optimisation/algo/route');

const REGLAGE = {
  campagne_id: CAMPAGNE, algo_id: 'uniformiser_par_regie', algo_version: 1, libelle: 'Uniformiser par régie',
  etat: 'a_venir', surcharges: { alpha: 0.4 }, parametres_effectifs: { alpha: 0.4 }, enregistre: true,
  maj_par: 'u-prop', maj_le: '2026-11-05T09:30:00Z',
};
const ENTREE = {
  id: 'e1', modifie_par: 'u-prop', role_auteur: 'client', modifie_le: '2026-11-05T09:30:00Z',
  algo_avant: 'uniformiser_global', parametres_avant: {}, algo_apres: 'uniformiser_par_regie', algo_version_apres: 1,
  parametres_apres: { alpha: 0.4 },
};

const repondre = (corps: unknown, status = 200) =>
  vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify(corps), { status, headers: { 'Content-Type': 'application/json' } }));

const contexte = (id = CAMPAGNE) => ({ params: Promise.resolve({ campaignId: id }) });
const url = (id = CAMPAGNE) => `http://localhost/api/campaigns/${id}/optimisation/algo`;
const lire = (id = CAMPAGNE) => GET(new NextRequest(url(id)), contexte(id));
const regler = (corps: unknown, id = CAMPAGNE) =>
  PUT(new NextRequest(url(id), { method: 'PUT', body: JSON.stringify(corps) }), contexte(id));

function entetes(f: ReturnType<typeof repondre>): Record<string, string> {
  return (f.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
}

beforeEach(() => {
  profil = { id: 'u-prop', role: 'client', organization_id: PROPRIETAIRE };
  campagneExiste = true;
  vi.stubEnv('OPTIMISATION_URL', 'http://127.0.0.1:8090');
  vi.stubEnv('OPTIMISATION_CLE_INTERNE', CLE);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('resoudreDroitAlgo', () => {
  const liees = [PROPRIETAIRE, PARTENAIRE];
  it('propriétaire (admin ou client) : règle', () => {
    expect(resoudreDroitAlgo('client', PROPRIETAIRE, PROPRIETAIRE, liees))
      .toEqual({ acces: 'reglage', espace: PROPRIETAIRE, role: 'client' });
    expect(resoudreDroitAlgo('admin', PROPRIETAIRE, PROPRIETAIRE, []).acces).toBe('reglage');
  });
  it('super_admin d un autre espace : règle, au nom de l espace propriétaire', () => {
    expect(resoudreDroitAlgo('super_admin', ETRANGER, PROPRIETAIRE, []))
      .toEqual({ acces: 'reglage', espace: PROPRIETAIRE, role: 'super_admin' });
  });
  it('espace partagé : lit seulement', () => {
    expect(resoudreDroitAlgo('admin', PARTENAIRE, PROPRIETAIRE, liees).acces).toBe('lecture');
  });
  it('autre espace, sans organisation, rôle hors modèle ou campagne sans propriétaire : introuvable', () => {
    expect(resoudreDroitAlgo('admin', ETRANGER, PROPRIETAIRE, liees).acces).toBe('introuvable');
    expect(resoudreDroitAlgo('client', null, PROPRIETAIRE, liees).acces).toBe('introuvable');
    expect(resoudreDroitAlgo('editor', PROPRIETAIRE, PROPRIETAIRE, liees).acces).toBe('introuvable');
    expect(resoudreDroitAlgo('client', PROPRIETAIRE, null, liees).acces).toBe('introuvable');
  });
});

describe('GET /api/campaigns/[campaignId]/optimisation/algo', () => {
  it('sans session : 401, aucun appel', async () => {
    profil = null;
    const f = repondre({});
    vi.stubGlobal('fetch', f);
    expect((await lire()).status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });

  it('identifiant invalide : 400', async () => {
    expect((await lire('pas-un-uuid')).status).toBe(400);
  });

  it('relaie le réglage et le journal, X-Espace = propriétaire, peut_regler', async () => {
    const f = repondre({ reglage: REGLAGE, journal: [ENTREE], journal_tronque: false });
    vi.stubGlobal('fetch', f);
    const r = await lire();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ reglage: REGLAGE, journal: [ENTREE], journal_tronque: false, peut_regler: true });
    expect(f.mock.calls[0]?.[0]).toBe(`http://127.0.0.1:8090/v1/campagnes/${CAMPAGNE}/algo`);
    expect(f.mock.calls[0]?.[1]?.method).toBe('GET');
    expect(entetes(f)).toMatchObject({ 'X-Espace': PROPRIETAIRE, 'X-Optimisation-Cle': CLE });
  });

  it('espace partagé : lit, peut_regler faux, X-Espace reste le propriétaire', async () => {
    profil = { id: 'u-part', role: 'admin', organization_id: PARTENAIRE };
    const f = repondre({ reglage: REGLAGE, journal: [], journal_tronque: false });
    vi.stubGlobal('fetch', f);
    const r = await lire();
    expect((await r.json()).peut_regler).toBe(false);
    expect(entetes(f)['X-Espace']).toBe(PROPRIETAIRE);
  });

  it('autre espace ou campagne inexistante : 404, aucun appel', async () => {
    const f = repondre({});
    vi.stubGlobal('fetch', f);
    profil = { id: 'u-etr', role: 'admin', organization_id: ETRANGER };
    expect((await lire()).status).toBe(404);
    profil = { id: 'u-prop', role: 'client', organization_id: PROPRIETAIRE };
    campagneExiste = false;
    expect((await lire()).status).toBe(404);
    expect(f).not.toHaveBeenCalled();
  });

  it('404 du service (hors espace) : 404 Campagne introuvable', async () => {
    vi.stubGlobal('fetch', repondre({ detail: { refus: 'hors_espace', message: 'Campagne introuvable dans cet espace.' } }, 404));
    const r = await lire();
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'Campagne introuvable.' });
  });

  it('service injoignable : 503, réponse d une autre forme : 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect((await lire()).status).toBe(503);
    vi.stubGlobal('fetch', repondre({ reglage: { algo_id: 3 } }));
    expect((await lire()).status).toBe(502);
  });
});

describe('PUT /api/campaigns/[campaignId]/optimisation/algo', () => {
  it('propriétaire : transmet le choix et l identité, relaie le résultat', async () => {
    const f = repondre({ reglage: REGLAGE, change: true, entree: ENTREE });
    vi.stubGlobal('fetch', f);
    const r = await regler({ algo_id: 'uniformiser_par_regie', parametres: { alpha: 0.4 } });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ reglage: REGLAGE, change: true, entree: ENTREE });
    expect(f.mock.calls[0]?.[1]?.method).toBe('PUT');
    expect(JSON.parse(String(f.mock.calls[0]?.[1]?.body)))
      .toEqual({ algo_id: 'uniformiser_par_regie', parametres: { alpha: 0.4 } });
    expect(entetes(f)).toMatchObject({
      'X-Espace': PROPRIETAIRE, 'X-Utilisateur': 'u-prop', 'X-Role': 'client', 'Content-Type': 'application/json',
    });
  });

  it('sans paramètres : surcharges vides envoyées (retour aux défauts)', async () => {
    const f = repondre({ reglage: REGLAGE, change: true, entree: ENTREE });
    vi.stubGlobal('fetch', f);
    await regler({ algo_id: 'uniformiser_global' });
    expect(JSON.parse(String(f.mock.calls[0]?.[1]?.body))).toEqual({ algo_id: 'uniformiser_global', parametres: {} });
  });

  it('super_admin d un autre espace : X-Espace = propriétaire, X-Role = super_admin', async () => {
    profil = { id: 'u-sa', role: 'super_admin', organization_id: ETRANGER };
    const f = repondre({ reglage: REGLAGE, change: true, entree: ENTREE });
    vi.stubGlobal('fetch', f);
    expect((await regler({ algo_id: 'uniformiser_par_regie' })).status).toBe(200);
    expect(entetes(f)).toMatchObject({ 'X-Espace': PROPRIETAIRE, 'X-Role': 'super_admin', 'X-Utilisateur': 'u-sa' });
  });

  it('espace partagé : 403, aucun appel', async () => {
    profil = { id: 'u-part', role: 'admin', organization_id: PARTENAIRE };
    const f = repondre({});
    vi.stubGlobal('fetch', f);
    const r = await regler({ algo_id: 'uniformiser_par_regie' });
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe('droit_insuffisant');
    expect(f).not.toHaveBeenCalled();
  });

  it('autre espace : 404, aucun appel', async () => {
    profil = { id: 'u-etr', role: 'admin', organization_id: ETRANGER };
    const f = repondre({});
    vi.stubGlobal('fetch', f);
    expect((await regler({ algo_id: 'uniformiser_par_regie' })).status).toBe(404);
    expect(f).not.toHaveBeenCalled();
  });

  it.each([
    [{}],
    [{ algo_id: '' }],
    [{ algo_id: 'uniformiser_global', autre: 1 }],
    [{ algo_id: 'uniformiser_global', parametres: { alpha: '0.5' } }],
  ])('corps invalide %j : 400, aucun appel', async (corps) => {
    const f = repondre({});
    vi.stubGlobal('fetch', f);
    expect((await regler(corps)).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it.each([
    ['algo_inconnu', 'Algorithme inconnu : « x ». Il n\'est pas au catalogue.'],
    ['algo_non_proposable', "L'algorithme « Rebid plafonné (historique) » est réservé au simulateur : il ne peut pas être choisi pour une campagne."],
    ['algo_autre_famille', "L'algorithme « Plan par jeu de zones » n'est pas de la famille « correction » : il ne peut pas être choisi ici."],
    ['parametre_invalide', '« Force de la correction (α) » : 2 hors des bornes [0.1 ; 1.0].'],
  ])('refus %s du service : 422 relayé en français', async (refus, message) => {
    vi.stubGlobal('fetch', repondre({ detail: { refus, algo_id: 'x', message } }, 422));
    const r = await regler({ algo_id: 'x' });
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ error: refus, message });
  });

  it('délai dépassé : 504', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => new Promise((_ok, ko) => {
      init?.signal?.addEventListener('abort', () => ko(Object.assign(new Error('abort'), { name: 'AbortError' })));
    })));
    vi.useFakeTimers();
    const r = regler({ algo_id: 'uniformiser_par_regie' });
    await vi.advanceTimersByTimeAsync(31_000);
    vi.useRealTimers();
    expect((await r).status).toBe(504);
  });
});
