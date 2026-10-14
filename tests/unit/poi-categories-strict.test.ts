import { describe, it, expect, vi, beforeEach } from 'vitest';

let reponse: { data: unknown; error: { message: string } | null } = { data: [], error: null };
const builder: Record<string, unknown> = {};
for (const m of ['select', 'gt', 'neq', 'in', 'not', 'order']) builder[m] = () => builder;
/** File de réponses consommée dans l'ordre (une par requête) ; vide → `reponse`. */
let file: { data: unknown; error: { message: string } | null }[] = [];
builder.limit = async () => file.shift() ?? reponse;

vi.mock('@/lib/auth', () => ({ createAdminClient: () => ({ from: () => builder }) }));
vi.mock('@/lib/logger', () => ({ logger: { debug: () => {} } }));

import { getDistinctCategories, getCategoriesVisibles, invalidateCategoriesCache } from '@/lib/poi/categories';

beforeEach(() => {
  file = [];
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

  it('surEchec : signalé quand une lecture échoue sans strict, jamais sur une lecture réussie', async () => {
    const echec = vi.fn();
    reponse = { data: null, error: { message: 'boum' } };
    expect(await getDistinctCategories({ surEchec: echec })).toEqual([]);
    expect(echec).toHaveBeenCalledTimes(1);

    invalidateCategoriesCache();
    reponse = { data: [], error: null };
    await getDistinctCategories(); // cache à []
    const echec2 = vi.fn();
    reponse = { data: null, error: { message: 'coupe' } };
    expect(await getCategoriesVisibles(['s1'], { surEchec: echec2 })).toEqual([]);
    expect(echec2).toHaveBeenCalledTimes(1);

    const ok = vi.fn();
    reponse = { data: [], error: null };
    await getCategoriesVisibles(['s1'], { surEchec: ok });
    expect(ok).not.toHaveBeenCalled();
  });

  it('échec à froid de la lecture GLOBALE : le résultat dégradé n est pas mis en cache, le 2e appel relit et voit juste', async () => {
    const lycee = { data: [{ categorie: 'lycee' }], error: null };
    const fin = { data: [], error: null };
    // 1er appel : leapfrog global en échec (rien en cache), puis leapfrog des visibles réussi.
    file = [{ data: null, error: { message: 'froid' } }, lycee, fin];
    const echec = vi.fn();
    expect(await getCategoriesVisibles(['s1'], { surEchec: echec })).toEqual([]);
    expect(echec).toHaveBeenCalledTimes(1);
    // 2e appel (« Réessayer ») : global réussi, PUIS les visibles relus — pas le [] du premier appel.
    file = [lycee, fin, lycee, fin];
    const echec2 = vi.fn();
    expect(await getCategoriesVisibles(['s1'], { surEchec: echec2 })).toEqual(['lycee']);
    expect(echec2).not.toHaveBeenCalled();
    expect(file).toEqual([]);
    // 3e appel : régime normal, servi par le cache des visibles (aucune lecture de plus que le global, en cache lui aussi).
    file = [{ data: null, error: { message: 'ne doit pas être lu' } }];
    expect(await getCategoriesVisibles(['s1'])).toEqual(['lycee']);
    expect(file.length).toBe(1);
  });
});
