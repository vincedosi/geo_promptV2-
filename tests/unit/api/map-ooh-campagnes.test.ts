import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Routes de lecture des campagnes OOH (spec 2026-10-16-ooh-campagnes § 5) : l'espace ACTIF de la session décide de
 * tout ; un identifiant non UUID est refusé avant toute lecture ; une campagne d'un autre espace est un 404.
 */
type Session = { userId: string; role: string; orgId: string | null } | null;
let session: Session = null;
// La session est simulée ; la règle « espace = UUID de la session » est la VRAIE (`orgIdDeSession`).
vi.mock('@/lib/auth/getSessionOrg', async (importOriginal) => {
  const reel = await importOriginal<typeof import('@/lib/auth/getSessionOrg')>();
  return { ...reel, getSessionOrg: async () => session, orgIdActif: async () => reel.orgIdDeSession(session as never) };
});

const appels: { nom: string; args: Record<string, unknown> }[] = [];
let reponse: { data: unknown; error: { message: string } | null } = { data: null, error: null };
vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    rpc: async (nom: string, args: Record<string, unknown>) => {
      appels.push({ nom, args });
      return reponse;
    },
  }),
}));

const { GET: lister } = await import('@/app/api/map/ooh/campagnes/route');
const { GET: lire } = await import('@/app/api/map/ooh/campagnes/[id]/route');

const ORG = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const AUTRE_ORG = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const CAMPAGNE = '6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const requete = (url: string) => ({ nextUrl: new URL(url), url, headers: new Headers(), cookies: { get: () => undefined } }) as never;

beforeEach(() => {
  appels.length = 0;
  session = { userId: 'u', role: 'client', orgId: ORG };
  reponse = { data: null, error: null };
});

describe('GET /api/map/ooh/campagnes', () => {
  it('lit les campagnes de l espace actif, bornées à 200', async () => {
    reponse = { data: { campagnes: [{ id: CAMPAGNE, nom: 'Essai', lignes: [] }], tronque: false }, error: null };
    const res = await lister(requete('http://localhost/api/map/ooh/campagnes'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ campagnes: [{ id: CAMPAGNE, nom: 'Essai', lignes: [] }], tronque: false });
    expect(appels).toEqual([{ nom: 'campagnes_ooh_jsonb', args: { p_org: ORG, p_limite: 200 } }]);
  });

  it.each([
    ['sans session', null],
    ['sans espace actif', { userId: 'u', role: 'super_admin', orgId: null }],
    ['espace non UUID', { userId: 'u', role: 'client', orgId: 'pas-un-uuid' }],
  ] as [string, Session][])('%s : liste vide, aucune lecture', async (_nom, s) => {
    session = s;
    const res = await lister(requete('http://localhost/api/map/ooh/campagnes'));
    expect(await res.json()).toEqual({ campagnes: [], tronque: false });
    expect(appels).toEqual([]);
  });

  it('un espace passé par l appelant (org, organization_id, p_org) est ignoré : seul l espace de la session compte', async () => {
    reponse = { data: { campagnes: [], tronque: false }, error: null };
    const url = `http://localhost/api/map/ooh/campagnes?org=${AUTRE_ORG}&organization_id=${AUTRE_ORG}&p_org=${AUTRE_ORG}&p_limite=99999`;
    await lister(requete(url));
    expect(appels).toEqual([{ nom: 'campagnes_ooh_jsonb', args: { p_org: ORG, p_limite: 200 } }]);
  });

  it('sans espace de session, un espace passé par l appelant ne rouvre rien', async () => {
    session = { userId: 'u', role: 'super_admin', orgId: null };
    const res = await lister(requete(`http://localhost/api/map/ooh/campagnes?org=${AUTRE_ORG}&p_org=${AUTRE_ORG}`));
    expect(await res.json()).toEqual({ campagnes: [], tronque: false });
    expect(appels).toEqual([]);
  });

  it('lecture en échec : 500 en français, détail au journal seulement', async () => {
    reponse = { data: null, error: { message: 'relation does not exist' } };
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await lister(requete('http://localhost/api/map/ooh/campagnes'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Campagnes OOH indisponibles.' });
    expect(journal).toHaveBeenCalled();
    journal.mockRestore();
  });
});

describe('GET /api/map/ooh/campagnes/[id]', () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  it('rend la campagne de l espace actif, bornée à 20 000 emplacements', async () => {
    reponse = { data: { campagne: { id: CAMPAGNE }, lignes: [], emplacements: [], tronque: false }, error: null };
    const res = await lire(requete(`http://localhost/api/map/ooh/campagnes/${CAMPAGNE}`), params(CAMPAGNE));
    expect(res.status).toBe(200);
    expect(appels).toEqual([{ nom: 'campagne_ooh_jsonb', args: { p_campagne: CAMPAGNE, p_org: ORG, p_limite: 20000 } }]);
  });

  it('un espace passé par l appelant (org, organization_id, p_org) est ignoré', async () => {
    reponse = { data: { campagne: { id: CAMPAGNE }, lignes: [], emplacements: [], tronque: false }, error: null };
    const url = `http://localhost/api/map/ooh/campagnes/${CAMPAGNE}?org=${AUTRE_ORG}&organization_id=${AUTRE_ORG}&p_org=${AUTRE_ORG}&p_limite=1`;
    await lire(requete(url), params(CAMPAGNE));
    expect(appels).toEqual([{ nom: 'campagne_ooh_jsonb', args: { p_campagne: CAMPAGNE, p_org: ORG, p_limite: 20000 } }]);
  });

  it('identifiant non UUID : 400, aucune lecture', async () => {
    const res = await lire(requete('http://localhost/api/map/ooh/campagnes/abc'), params('abc'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Identifiant de campagne invalide.' });
    expect(appels).toEqual([]);
  });

  it('campagne d un autre espace (la RPC rend null) : 404', async () => {
    reponse = { data: null, error: null };
    const res = await lire(requete(`http://localhost/api/map/ooh/campagnes/${CAMPAGNE}`), params(CAMPAGNE));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Campagne introuvable dans cet espace de travail.' });
    // La RPC a bien été interrogée avec l'espace de la SESSION, pas un autre.
    expect(appels[0].args.p_org).toBe(ORG);
  });

  it('sans espace actif : 404, aucune lecture', async () => {
    session = { userId: 'u', role: 'super_admin', orgId: null };
    const res = await lire(requete(`http://localhost/api/map/ooh/campagnes/${CAMPAGNE}`), params(CAMPAGNE));
    expect(res.status).toBe(404);
    expect(appels).toEqual([]);
  });

  it('lecture en échec : 500 en français', async () => {
    reponse = { data: null, error: { message: 'timeout' } };
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await lire(requete(`http://localhost/api/map/ooh/campagnes/${CAMPAGNE}`), params(CAMPAGNE));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Campagne OOH indisponible.' });
    journal.mockRestore();
  });
});
