import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `DELETE /api/custom-geo/[id]` refuse une zone CITÉE (lot 3, revue T10) : la garde passe par `zone_referencee`
 * (sql/253), qui couvre stratégie, jeu de zones, composite React (`source_metadata.member_zone_ids`), combinaison
 * (`recette.zones`) et périmètre d'une recette (`recette.perimetre`). Avant, seuls la stratégie et
 * `member_zone_ids` étaient vus : un membre d'une combinaison Angular se supprimait et cassait son recalcul.
 */
vi.mock('@/lib/api/middleware', () => ({
  requireAuth: async () => ({ id: 'u1', role: 'super_admin', organization_id: 'o1' }),
  authUnauthorized: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/campaigns/access', () => ({ checkZoneAccess: async () => 'ok' }));

let reference: { data: unknown; error: unknown } = { data: null, error: null };
const rpcs: { nom: string; args: unknown }[] = [];
const suppressions: unknown[] = [];
vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    rpc(nom: string, args: unknown) { rpcs.push({ nom, args }); return Promise.resolve(nom === 'zone_referencee' ? reference : { data: null, error: null }); },
    from(table: string) {
      const c = {
        select() { return c; }, limit() { return Promise.resolve({ data: [], error: null }); }, contains() { return c; },
        delete() { return { eq: (_col: string, v: unknown) => { suppressions.push([table, v]); return Promise.resolve({ error: null }); } }; },
        eq() { return c; },
      };
      return c;
    },
  }),
}));

const { DELETE } = await import('@/app/api/custom-geo/[id]/route');
const ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3309';
const appeler = () => DELETE(new Request(`http://localhost/api/custom-geo/${ID}`, { method: 'DELETE' }) as never, { params: Promise.resolve({ id: ID }) });

describe('DELETE /api/custom-geo/[id] — zone citée (zone_referencee)', () => {
  beforeEach(() => { rpcs.length = 0; suppressions.length = 0; reference = { data: null, error: null }; });

  for (const par of ['combinaison', 'perimetre', 'strategie', 'jeu_de_zones', 'composite']) {
    it(`citée par « ${par} » : 409 en français, rien de supprimé, jamais le mot « composite » dans le message`, async () => {
      reference = { data: par, error: null };
      const r = await appeler();
      expect(r.status).toBe(409);
      const corps = await r.json() as { error: string; refus: string; par: string };
      expect(corps.refus).toBe('zone_referencee');
      expect(corps.par).toBe(par);
      expect(corps.error).toMatch(/^Cette zone est utilisée/);
      expect(corps.error).not.toMatch(/composite/i);
      expect(rpcs).toEqual([{ nom: 'zone_referencee', args: { p_zone_id: ID } }]);
      expect(suppressions).toEqual([]);
    });
  }

  it('non citée : supprimée', async () => {
    const r = await appeler();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ deleted: true, id: ID });
    expect(suppressions).toEqual([['custom_geo_zones', ID]]);
  });

  it('la garde en échec : 500, rien de supprimé (on ne supprime pas à l’aveugle)', async () => {
    reference = { data: null, error: { message: 'timeout' } };
    const r = await appeler();
    expect(r.status).toBe(500);
    expect(suppressions).toEqual([]);
  });
});
