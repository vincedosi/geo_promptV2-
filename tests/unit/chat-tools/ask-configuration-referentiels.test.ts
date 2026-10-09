/**
 * `askConfiguration` compte les POI SANS source (référentiels système : arrêts
 * de transport, installations classées), qui sont du socle (sql/234).
 *
 * Sans `referentiels: true`, `filtrerParSourcesVisibles` restreint à
 * `data_source_id in (…)` : un client perdait toutes les catégories ICPE de
 * la configuration proposée par le chat, alors qu'il les voit sur la carte.
 */
import { describe, it, expect, vi } from 'vitest';

const filtres: string[] = [];

function chaine() {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'ilike', 'eq']) c[m] = () => c;
  c.in = (col: string) => { filtres.push(`in:${col}`); return c; };
  c.is = (col: string) => { filtres.push(`is:${col}`); return c; };
  c.or = (expr: string) => { filtres.push(`or:${expr}`); return c; };
  c.then = (ok: (r: unknown) => unknown) => Promise.resolve({ count: 3, error: null }).then(ok);
  return c;
}

vi.mock('@/lib/auth', () => ({ createAdminClient: () => ({ from: () => chaine() }) }));
vi.mock('@/lib/logger', () => ({ logger: { debug: () => {} } }));
vi.mock('@/lib/poi/categories', () => ({ getDistinctCategories: async () => ['icpe_seveso'] }));
vi.mock('@/lib/chat/tools/orgContext', () => ({
  getOrgSourceIds: () => ['3f2504e0-4f89-11d3-9a0c-0305e82c3301'],
}));

const { askConfiguration } = await import('@/lib/chat/tools/askConfiguration');

describe('askConfiguration — les référentiels sans source restent comptés', () => {
  it('filtre par « sans source OU source visible », jamais par la seule liste', async () => {
    const r = await askConfiguration({ perimetre_type: 'ville', perimetre_value: 'Lyon' }) as { options_poi: { id: string }[] };
    expect(filtres).toContain('or:data_source_id.is.null,data_source_id.in.(3f2504e0-4f89-11d3-9a0c-0305e82c3301)');
    expect(filtres).not.toContain('in:data_source_id');
    expect(r.options_poi.map((o) => o.id)).toEqual(['icpe_seveso']);
  });
});
