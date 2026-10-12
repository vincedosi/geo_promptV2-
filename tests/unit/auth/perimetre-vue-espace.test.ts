import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * La carte voit comme l'espace actif — super_admin compris (spec
 * droits-sur-la-carte, R3/R4, décision de Vincent du 2026-10-12).
 *
 * `sourcesVisiblesDeLaRequete` est le point d'entrée de toutes les routes de
 * la carte : elle doit TOUJOURS demander la vue espace. Les deux routes qui
 * appellent `getOrgSourceIds` directement (`map/categories`, `map/pois`)
 * aussi — un verrou par lecture de la source, contre une route qui
 * oublierait l'option et rendrait « tout » au super_admin.
 */

const espion = vi.fn(async (..._args: unknown[]): Promise<string[] | null> => ['socle-1']);

vi.mock('@/lib/auth/getSessionOrg', () => ({
  getSessionOrg: async () => ({
    userId: 'u',
    role: 'super_admin',
    orgId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
  }),
}));
vi.mock('@/lib/auth/getOrgSourceIds', () => ({
  getOrgSourceIds: (...args: unknown[]) => espion(...args),
}));

const { sourcesVisiblesDeLaRequete } = await import('@/lib/auth/perimetre-donnees');

describe('sourcesVisiblesDeLaRequete — la vue espace, toujours', () => {
  it('passe { vueEspace: true } à getOrgSourceIds, super_admin compris', async () => {
    espion.mockClear();
    expect(await sourcesVisiblesDeLaRequete({} as never)).toEqual(['socle-1']);
    expect(espion).toHaveBeenCalledTimes(1);
    expect(espion.mock.calls[0]).toEqual([
      expect.objectContaining({ role: 'super_admin' }),
      { vueEspace: true },
    ]);
  });

  it('ne rend jamais null, même si la règle en rendait un', async () => {
    espion.mockResolvedValueOnce(null);
    expect(await sourcesVisiblesDeLaRequete({} as never)).toEqual([]);
  });
});

describe('routes de la carte qui appellent getOrgSourceIds directement', () => {
  for (const f of [
    'app/api/map/categories/route.ts',
    'app/api/map/pois/route.ts',
    'app/api/chat/route.ts',
  ]) {
    it(`${f} passe vueEspace`, () => {
      expect(readFileSync(f, 'utf8')).toMatch(/getOrgSourceIds\([^)]*\{\s*vueEspace:\s*true\s*\}\)/);
    });
  }
});
