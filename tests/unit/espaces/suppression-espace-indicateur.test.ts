/**
 * Supprimer un espace qui possède un indicateur (lot « Catalogue et groupes »,
 * relecture T1-T3 n° 5).
 *
 * `data_sources.organization_id` cascade à la suppression de l'espace, et la FK
 * `restrict` de `cible_indicator_registry.data_source_id` (sql/288) bloque la
 * cascade : rien ne redevient public, rien n'est supprimé. La route rendait
 * pourtant le message brut de PostgreSQL en 500 ; elle répond désormais 409 en
 * français. Toute autre erreur reste un 500.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3309';
let erreurSuppression: { code: string; message: string } | null = null;

function chaine() {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq']) c[m] = () => c;
  c.single = async () => ({ data: { id: ID, slug: 'bercy' }, error: null });
  c.delete = () => ({ eq: async () => ({ error: erreurSuppression }) });
  return c;
}

vi.mock('@/lib/auth', () => ({ createAdminClient: () => ({ from: () => chaine() }) }));
vi.mock('@/lib/api/middleware', () => ({
  requireAdmin: async () => ({ id: '00000000-0000-0000-0000-00000000a11c', role: 'super_admin', organization_id: null }),
  adminUnauthorized: () => new Response(null, { status: 401 }),
}));

const { DELETE } = await import('@/app/api/admin/organizations/[id]/route');
const appeler = () => DELETE(
  new NextRequest(`http://localhost/api/admin/organizations/${ID}`, { method: 'DELETE' }),
  { params: Promise.resolve({ id: ID }) });

beforeEach(() => { erreurSuppression = null; });

describe('DELETE /api/admin/organizations/[id] — espace propriétaire d un indicateur', () => {
  it('la FK du registre bloque : 409 en français, sans le message PostgreSQL', async () => {
    erreurSuppression = {
      code: '23503',
      message: 'update or delete on table "data_sources" violates foreign key constraint '
        + '"cible_indicator_registry_data_source_id_fkey" on table "cible_indicator_registry"',
    };
    const res = await appeler();
    expect(res.status).toBe(409);
    const corps = await res.json() as { error: string; refus: string };
    expect(corps.refus).toBe('indicateur_possede');
    expect(corps.error).toMatch(/^Cet espace possède un indicateur/);
    expect(corps.error).not.toMatch(/foreign key|cible_indicator_registry/);
  });

  it('une autre violation de clé étrangère reste un 500', async () => {
    erreurSuppression = { code: '23503', message: 'violates foreign key constraint "autre_fkey" on table "autre"' };
    expect((await appeler()).status).toBe(500);
  });

  it('sans erreur : 200', async () => {
    expect((await appeler()).status).toBe(200);
  });
});
