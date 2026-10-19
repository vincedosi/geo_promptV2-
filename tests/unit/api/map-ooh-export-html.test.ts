import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/map/ooh/campagnes/[id]/export-html — le fichier HTML autonome d'une campagne (bible des priorités,
 * ligne 30). Même contrôle d'accès que la route `[id]` : l'espace ACTIF de la session décide, un identifiant non UUID
 * est refusé avant toute lecture, une campagne d'un autre espace est un 404. Le document lui-même est testé dans
 * `tests/unit/ooh/export-html.test.ts` ; ici, la réponse HTTP.
 */
type Session = { userId: string; role: string; orgId: string | null } | null;
let session: Session = null;
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

const { GET } = await import('@/app/api/map/ooh/campagnes/[id]/export-html/route');

const ORG = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const AUTRE_ORG = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const CAMPAGNE = '6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const requete = (url: string) => ({ nextUrl: new URL(url), url, headers: new Headers(), cookies: { get: () => undefined } }) as never;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const url = (id: string, qs = '') => `http://localhost/api/map/ooh/campagnes/${id}/export-html${qs}`;

const DETAIL = {
  campagne: { id: CAMPAGNE, nom: 'Marine nationale — TF4 septembre 2026', annonceur: null, vague: 'TF4', date_debut: '2026-09-20', date_fin: '2026-10-02', budget_total_ttc: null, metadata: {} },
  lignes: [],
  emplacements: [],
  tronque: false,
};

beforeEach(() => {
  appels.length = 0;
  session = { userId: 'u', role: 'client', orgId: ORG };
  reponse = { data: null, error: null };
});

describe('GET /api/map/ooh/campagnes/[id]/export-html', () => {
  it('rend la campagne de l espace actif en fichier HTML joint, nommé d après la campagne', async () => {
    reponse = { data: DETAIL, error: null };
    const res = await GET(requete(url(CAMPAGNE)), params(CAMPAGNE));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="marine-nationale-tf4-septembre-2026.html"; filename*=UTF-8\'\'marine-nationale-tf4-septembre-2026.html',
    );
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const html = await res.text();
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('Marine nationale — TF4 septembre 2026');
    // Lecture identique à la route [id] : même RPC jsonb, même borne, espace de la SESSION.
    expect(appels).toEqual([{ nom: 'campagne_ooh_jsonb', args: { p_campagne: CAMPAGNE, p_org: ORG, p_limite: 20000 } }]);
  });

  it('un espace passé par l appelant (org, organization_id, p_org) est ignoré', async () => {
    reponse = { data: DETAIL, error: null };
    await GET(requete(url(CAMPAGNE, `?org=${AUTRE_ORG}&organization_id=${AUTRE_ORG}&p_org=${AUTRE_ORG}`)), params(CAMPAGNE));
    expect(appels[0].args.p_org).toBe(ORG);
  });

  it('identifiant non UUID : 400 en JSON, aucune lecture', async () => {
    const res = await GET(requete(url('abc')), params('abc'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Identifiant de campagne invalide.' });
    expect(appels).toEqual([]);
  });

  it('campagne d un autre espace (la RPC rend null) : 404', async () => {
    const res = await GET(requete(url(CAMPAGNE)), params(CAMPAGNE));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Campagne introuvable dans cet espace de travail.' });
  });

  it.each([
    ['sans session', null],
    ['sans espace actif', { userId: 'u', role: 'super_admin', orgId: null }],
  ] as [string, Session][])('%s : 404, aucune lecture', async (_nom, s) => {
    session = s;
    const res = await GET(requete(url(CAMPAGNE)), params(CAMPAGNE));
    expect(res.status).toBe(404);
    expect(appels).toEqual([]);
  });

  it('lecture en échec : 500 en français, détail au journal seulement', async () => {
    reponse = { data: null, error: { message: 'timeout' } };
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(requete(url(CAMPAGNE)), params(CAMPAGNE));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Export de la campagne impossible.' });
    expect(journal).toHaveBeenCalled();
    journal.mockRestore();
  });
});
