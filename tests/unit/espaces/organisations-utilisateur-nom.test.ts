/**
 * `GET /api/user/organizations` alimente le badge de session (React ET
 * Angular). Il rendait `organizations.name` brut : le badge affichait
 * « GENESIS (Global) », nom abandonné (DESIGN_SYSTEM § 1). Le nom affiché est
 * désormais calculé côté serveur par `nomAffiche`, dans les deux branches
 * (super_admin et membre), sans toucher la base.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { SLUG_ORGANISATION_INTERNE } from '@/lib/espaces/nom-espace';

const INTERNE = { id: 'i', name: 'GENESIS (Global)', slug: SLUG_ORGANISATION_INTERNE, logo_url: null };
const CLIENT = { id: 'c', name: 'BMW GROUP', slug: 'bmw', logo_url: null };

let profil: { id: string; role: string; organization_id: string | null } | null = null;

vi.mock('@/lib/auth', () => ({
  getUserFromRequest: async () => profil,
  createAdminClient: () => ({
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order']) c[m] = () => c;
      const data = table === 'organizations'
        ? [INTERNE, CLIENT]
        : [{ organization_id: 'i', organizations: INTERNE }, { organization_id: 'c', organizations: CLIENT }];
      c.then = (ok: (r: unknown) => unknown) => Promise.resolve({ data, error: null }).then(ok);
      return c;
    },
  }),
}));

const { GET } = await import('@/app/api/user/organizations/route');

const requete = () => new NextRequest('http://localhost:3000/api/user/organizations', { headers: { authorization: 'Bearer x' } });

beforeEach(() => { profil = null; });

describe('GET /api/user/organizations — nom affiché', () => {
  it('401 sans session', async () => {
    expect((await GET(requete())).status).toBe(401);
  });

  it.each(['super_admin', 'client'])('%s : l espace interne s appelle « dentsu.explore (interne) », les autres gardent leur nom', async (role) => {
    profil = { id: 'u', role, organization_id: 'i' };
    const res = await GET(requete());
    const corps = await res.json() as { organizations: { id: string; name: string; slug: string }[] };
    expect(corps.organizations.map((o) => o.name)).toEqual(['dentsu.explore (interne)', 'BMW GROUP']);
    expect(corps.organizations[0].slug).toBe(SLUG_ORGANISATION_INTERNE);
    expect(JSON.stringify(corps)).not.toContain('GENESIS');
  });
});
