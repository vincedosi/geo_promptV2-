import { describe, it, expect, vi, beforeEach } from 'vitest';

let reponse: { data: unknown; error: { message: string } | null } = { data: [], error: null };
const builder: Record<string, unknown> = {};
for (const m of ['select', 'gt', 'neq', 'in', 'not', 'order']) builder[m] = () => builder;
builder.limit = async () => reponse;

vi.mock('@/lib/auth', () => ({ createAdminClient: () => ({ from: () => builder }) }));
vi.mock('@/lib/logger', () => ({ logger: { debug: () => {} } }));

import { getDistinctCategories, getCategoriesVisibles, invalidateCategoriesCache } from '@/lib/poi/categories';

beforeEach(() => {
  invalidateCategoriesCache();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('categories : mode strict', () => {
  it('sans option, une lecture en échec rend [] (comportement historique)', async () => {
    reponse = { data: null, error: { message: 'boum' } };
    expect(await getDistinctCategories()).toEqual([]);
  });

  it('strict : une lecture en échec lève', async () => {
    reponse = { data: null, error: { message: 'boum' } };
    await expect(getDistinctCategories({ strict: true })).rejects.toThrow(/lecture des catégories : boum/);
  });

  it('strict : la lecture restreinte aux sources visibles lève aussi', async () => {
    reponse = { data: [], error: null };
    await getDistinctCategories(); // cache à []
    reponse = { data: null, error: { message: 'coupe' } };
    expect(await getCategoriesVisibles(['s1'])).toEqual([]);
    await expect(getCategoriesVisibles(['s1'], { strict: true })).rejects.toThrow(/catégories visibles : coupe/);
  });
});
