import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Les listes de campagnes lues par la carte voient comme l'espace actif —
 * super_admin compris (spec droits-sur-la-carte, R3/R5 ; arbitrage du
 * 2026-10-12 après la revue finale : R3 et R5 valent pour TOUTE route non
 * admin de la carte).
 *
 * - `/api/digital/campaigns` (outil Corrélation, barre de campagne, suivi) :
 *   le super_admin dans un espace rendait TOUTES les campagnes (`orgId = null`).
 * - `/api/custom-geo/media-plan` (sélecteur du plan média) : le super_admin
 *   SANS espace (« Toutes les organisations ») rendait toutes les campagnes.
 *
 * Sans espace actif, la carte est au socle seul ; une campagne n'est jamais
 * du socle : la liste est vide, comme pour un client sans espace.
 */

const ESPACE = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

type Profil = { id: string; email: string; role: string; organization_id: string | null };
let profil: Profil | null = null;

// ── /api/digital/campaigns ──────────────────────────────────────────────────
const appelsRpc: Array<[string, Record<string, unknown>]> = [];
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: async (nom: string, args: Record<string, unknown>) => {
      appelsRpc.push([nom, args]);
      return { data: [], error: null };
    },
    from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }),
  }),
}));

// ── /api/custom-geo/media-plan ──────────────────────────────────────────────
const filtres: Array<[string, unknown]> = [];
let lecturesListe = 0;
function requeteListe() {
  lecturesListe++;
  const q = {
    select: () => q,
    order: () => q,
    eq: (col: string, val: unknown) => { filtres.push([col, val]); return q; },
    then: (ok: (v: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
  };
  return q;
}

vi.mock('@/lib/auth', () => ({
  getUserFromRequest: async () => profil,
  isSuperAdmin: (p: Profil | null) => p?.role === 'super_admin',
  createAdminClient: () => ({ from: () => requeteListe() }),
}));
vi.mock('@/lib/api/middleware', () => ({
  requireAuth: async () => profil,
  authUnauthorized: () => new Response(null, { status: 401 }),
}));

const { GET: GET_DIGITAL } = await import('@/app/api/digital/campaigns/route');
const { GET: GET_PLAN } = await import('@/app/api/custom-geo/media-plan/route');

const req = (url: string) => new NextRequest(`http://localhost${url}`, { headers: { authorization: 'Bearer t' } });

beforeEach(() => {
  appelsRpc.length = 0;
  filtres.length = 0;
  lecturesListe = 0;
});

describe('/api/digital/campaigns — la liste de l’espace actif', () => {
  it('super_admin DANS un espace : la RPC reçoit cet espace, jamais null (« tout »)', async () => {
    profil = { id: 'u', email: 'a@b', role: 'super_admin', organization_id: ESPACE };
    const res = await GET_DIGITAL(req('/api/digital/campaigns'));
    expect(res.status).toBe(200);
    expect(appelsRpc[0]).toEqual(['get_digital_campaigns_list', { p_organization_id: ESPACE }]);
  });

  it('super_admin SANS espace : liste vide, la RPC n’est pas appelée', async () => {
    profil = { id: 'u', email: 'a@b', role: 'super_admin', organization_id: null };
    const res = await GET_DIGITAL(req('/api/digital/campaigns'));
    expect(await res.json()).toEqual([]);
    expect(appelsRpc).toEqual([]);
  });

  it('client : inchangé, la RPC reçoit son espace', async () => {
    profil = { id: 'u', email: 'a@b', role: 'client', organization_id: ESPACE };
    await GET_DIGITAL(req('/api/digital/campaigns'));
    expect(appelsRpc[0]).toEqual(['get_digital_campaigns_list', { p_organization_id: ESPACE }]);
  });
});

describe('/api/custom-geo/media-plan (liste) — la liste de l’espace actif', () => {
  it('super_admin DANS un espace : filtré sur cet espace', async () => {
    profil = { id: 'u', email: 'a@b', role: 'super_admin', organization_id: ESPACE };
    const res = await GET_PLAN(req('/api/custom-geo/media-plan'));
    expect(res.status).toBe(200);
    expect(filtres).toEqual([['organization_id', ESPACE]]);
  });

  it('super_admin SANS espace : liste vide, aucune lecture', async () => {
    profil = { id: 'u', email: 'a@b', role: 'super_admin', organization_id: null };
    const res = await GET_PLAN(req('/api/custom-geo/media-plan'));
    expect(await res.json()).toEqual({ campaigns: [] });
    expect(lecturesListe).toBe(0);
  });
});
