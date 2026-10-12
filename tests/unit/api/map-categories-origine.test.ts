import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * GET /api/map/categories — l'origine de chaque catégorie (spec
 * droits-sur-la-carte, § 3.2, R6) : « espace » si au moins un POI visible
 * vient d'une source propre à l'espace actif, « commune » sinon. Une catégorie
 * mixte est rangée « espace ».
 */

const propres = vi.fn(async (): Promise<string[]> => ['p1']);
const visibles = vi.fn(async (sources: string[] | null): Promise<string[]> => {
  if (sources?.length === 1 && sources[0] === 'p1') return ['bmw'];
  return ['bmw', 'lycee'];
});

vi.mock('@/lib/auth/getSessionOrg', () => ({
  getSessionOrg: async () => ({ userId: 'u', role: 'super_admin', orgId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' }),
}));
vi.mock('@/lib/auth/getOrgSourceIds', () => ({
  getOrgSourceIds: async () => ['s1', 'p1'],
  getSourcesPropresEspace: () => propres(),
}));
vi.mock('@/lib/poi/categories', () => ({
  getDistinctCategories: async () => ['bmw', 'cirfa', 'lycee'],
  getCategoriesVisibles: (s: string[] | null) => visibles(s),
  invalidateCategoriesCache: () => {},
}));

// Libellés vides : `poi_categories` ne rend rien.
function chaineLibelles() {
  const chaine = {
    select() { return chaine; },
    in() { return chaine; },
    then<T>(ok: (r: { data: unknown[]; error: null }) => T) {
      return Promise.resolve({ data: [], error: null }).then(ok);
    },
  };
  return chaine;
}
vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({ from: () => chaineLibelles() }),
}));

const { GET } = await import('@/app/api/map/categories/route');

type Categorie = { id: string; label: string; origine: string };

async function appeler(): Promise<Categorie[]> {
  const req = { nextUrl: new URL('http://localhost/api/map/categories') } as never;
  const res = await GET(req);
  const corps = (await res.json()) as { categories: Categorie[] };
  return corps.categories;
}

const origine = (cats: Categorie[], id: string) => cats.find((c) => c.id === id)?.origine;

describe('GET /api/map/categories — origine', () => {
  beforeEach(() => {
    propres.mockClear();
    visibles.mockClear();
  });

  it('catégorie d une source propre → espace ; socle seul → commune', async () => {
    const cats = await appeler();
    expect(cats.map((c) => c.id)).toEqual(['bmw', 'lycee']);
    expect(origine(cats, 'bmw')).toBe('espace');
    expect(origine(cats, 'lycee')).toBe('commune');
    // id et label sont toujours là : rien n'est retiré de la réponse.
    expect(cats[0]).toMatchObject({ id: 'bmw', label: 'Bmw' });
  });

  it('catégorie mixte (socle + espace) → espace', async () => {
    // Les lycées de la source propre `p1` côtoient ceux du socle `s1`.
    visibles.mockImplementationOnce(async () => ['bmw', 'lycee'])
      .mockImplementationOnce(async () => ['lycee']);
    const cats = await appeler();
    expect(origine(cats, 'lycee')).toBe('espace');
    expect(origine(cats, 'bmw')).toBe('commune');
    expect(visibles.mock.calls[1]).toEqual([['p1']]);
  });

  it('aucune source propre → tout commune, un seul leapfrog', async () => {
    propres.mockResolvedValueOnce([]);
    const cats = await appeler();
    expect(cats.every((c) => c.origine === 'commune')).toBe(true);
    expect(visibles).toHaveBeenCalledTimes(1);
  });
});
