/**
 * L'espace interne est reconnu par son IDENTIFIANT, pas par son slug.
 *
 * La garde de suppression comparait le slug, que PATCH pouvait changer : un
 * PATCH `{ slug: 'autre' }` suivi d'un DELETE supprimait l'espace qui porte
 * les données du socle. On la clé désormais sur l'id, et PATCH refuse de
 * renommer le slug de l'espace interne (des scripts et la démo le lisent).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ID_ORGANISATION_INTERNE, SLUG_ORGANISATION_INTERNE } from '@/lib/espaces/nom-espace';

const ecritures: string[] = [];
let slugEnBase = 'renomme-par-un-patch';

function chaine(table: string) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'neq', 'or', 'order', 'in']) c[m] = () => c;
  c.update = () => { ecritures.push(`update ${table}`); return c; };
  c.delete = () => { ecritures.push(`delete ${table}`); return c; };
  c.single = async () => ({ data: { id: ID_ORGANISATION_INTERNE, slug: slugEnBase }, error: null });
  c.then = (ok: (r: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok);
  return c;
}

vi.mock('@/lib/auth', () => ({ createAdminClient: () => ({ from: (t: string) => chaine(t) }) }));
vi.mock('@/lib/api/middleware', () => ({
  requireAdmin: async () => ({ id: '00000000-0000-0000-0000-00000000a11c', role: 'super_admin', organization_id: null }),
  adminUnauthorized: () => new Response(null, { status: 401 }),
}));

const { DELETE, PATCH } = await import('@/app/api/admin/organizations/[id]/route');

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => { ecritures.length = 0; });

describe('espace interne — garde par identifiant', () => {
  it('DELETE refuse en 409 même si le slug a été changé', async () => {
    slugEnBase = 'renomme-par-un-patch';
    const res = await DELETE(
      new NextRequest(`http://localhost/api/admin/organizations/${ID_ORGANISATION_INTERNE}`, { method: 'DELETE' }),
      params(ID_ORGANISATION_INTERNE));
    expect(res.status).toBe(409);
    expect(ecritures).toEqual([]);
  });

  it('PATCH refuse en 409 de changer le slug de l espace interne', async () => {
    const res = await PATCH(
      new NextRequest(`http://localhost/api/admin/organizations/${ID_ORGANISATION_INTERNE}`, {
        method: 'PATCH', body: JSON.stringify({ slug: 'autre-chose' }), headers: { 'content-type': 'application/json' },
      }),
      params(ID_ORGANISATION_INTERNE));
    expect(res.status).toBe(409);
    expect(ecritures).toEqual([]);
  });

  it('PATCH laisse passer le slug inchangé (l écran renvoie le formulaire entier)', async () => {
    slugEnBase = SLUG_ORGANISATION_INTERNE;
    const res = await PATCH(
      new NextRequest(`http://localhost/api/admin/organizations/${ID_ORGANISATION_INTERNE}`, {
        method: 'PATCH', body: JSON.stringify({ slug: SLUG_ORGANISATION_INTERNE, name: 'GENESIS (Global)' }),
        headers: { 'content-type': 'application/json' },
      }),
      params(ID_ORGANISATION_INTERNE));
    expect(res.status).toBe(200);
    expect(ecritures).toEqual(['update organizations']);
  });
});
