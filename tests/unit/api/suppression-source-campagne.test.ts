/**
 * `DELETE /api/admin/sources/[id]` — une source dont les panneaux sont réservés par une campagne.
 *
 * Les liens `campagne_ligne_panneaux` sont `on delete restrict` côté panneau (sql/261) : la suppression des panneaux
 * échoue en 23503. La route disait « relancez la suppression », ce qui échouait à l'identique. Elle dit maintenant
 * pourquoi, garde la source, et ne tente pas d'effacer la source.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

let erreurPanneaux: { code: string; message: string } | null = null;
const suppressions: string[] = [];

function constructeur(table: string) {
  let suppression = false;
  let unique = false;
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.delete = () => { suppression = true; suppressions.push(table); return c; };
  c.eq = () => c;
  c.single = () => { unique = true; return c; };
  c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
    let reponse: unknown = { data: null, error: null, count: 0 };
    if (unique) reponse = { data: { type: 'panneaux', geo_config: null, organization_id: null }, error: null };
    else if (suppression && table === 'panneaux_affichage') reponse = { data: null, error: erreurPanneaux, count: null };
    return Promise.resolve(reponse).then(ok, ko);
  };
  return c;
}

vi.mock('@/lib/auth', () => ({ createAdminClient: () => ({ from: (table: string) => constructeur(table) }) }));
vi.mock('@/lib/api/middleware', () => ({
  requireAdmin: async () => ({ id: 'u', organization_id: 'o', role: 'super_admin' }),
  adminUnauthorized: () => new Response(null, { status: 401 }),
}));

async function supprimer(): Promise<{ statut: number; corps: { success: boolean; error?: string } }> {
  const { DELETE } = await import('@/app/api/admin/sources/[id]/route');
  const res = await DELETE(new NextRequest('http://localhost/api/admin/sources/s', { method: 'DELETE' }), { params: Promise.resolve({ id: 's' }) });
  return { statut: res.status, corps: await res.json() };
}

beforeEach(() => {
  erreurPanneaux = null;
  suppressions.length = 0;
});

describe('DELETE /api/admin/sources/[id] — panneaux réservés par une campagne', () => {
  it('23503 : 409, message qui nomme la campagne, aucune invitation à relancer, la source reste', async () => {
    erreurPanneaux = { code: '23503', message: 'violates foreign key constraint' };
    const { statut, corps } = await supprimer();
    expect(statut).toBe(409);
    expect(corps.success).toBe(false);
    expect(corps.error).toContain('Ces panneaux appartiennent à une campagne');
    expect(corps.error).not.toContain('relancez');
    expect(suppressions).toEqual(['poi_france', 'panneaux_affichage']);
  });

  it('une autre erreur garde son message d origine', async () => {
    erreurPanneaux = { code: '57014', message: 'statement timeout' };
    const { statut, corps } = await supprimer();
    expect(statut).toBe(500);
    expect(corps.error).toContain('relancez la suppression');
    expect(suppressions).not.toContain('data_sources');
  });
});
