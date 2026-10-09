/**
 * Cache des catégories VISIBLES, par empreinte de périmètre.
 *
 * Mesuré le 2026-10-09 (EXPLAIN BUFFERS, base locale) : un appel de
 * `getCategoriesVisibles` pour un client ou un appelant sans session lisait
 * ≈ 35 000 pages (≈ 270 Mo) — 18 511 sur idx_poi_france_categorie en écartant
 * 285 000 arrêts de transport, puis 16 335. Sans cache, à CHAQUE appel de
 * `/api/map/categories` (route publique) et du chat.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Un « catalogue » de deux catégories : la lecture globale et la lecture
// restreinte avancent toutes deux par `gt(categorie, dernier vu)`.
const CATALOGUE = ['cirfa', 'lycee'];
let echec = false;
let lectures = 0;

function nouveauBuilder() {
  let apres = '';
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'neq', 'in', 'not', 'order']) b[m] = () => b;
  b.gt = (_c: string, v: string) => { apres = v; return b; };
  b.limit = async () => {
    lectures++;
    if (echec) return { data: null, error: { message: 'coupe' } };
    const suivante = CATALOGUE.find((c) => c > apres);
    return { data: suivante ? [{ categorie: suivante }] : [], error: null };
  };
  return b;
}

vi.mock('@/lib/auth', () => ({ createAdminClient: () => ({ from: () => nouveauBuilder() }) }));
vi.mock('@/lib/logger', () => ({ logger: { debug: () => {} } }));

import { getCategoriesVisibles, getDistinctCategories, invalidateCategoriesCache } from '@/lib/poi/categories';

beforeEach(async () => {
  invalidateCategoriesCache();
  echec = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await getDistinctCategories(); // cache global chaud : on ne compte que la lecture restreinte
  lectures = 0;
});

describe('getCategoriesVisibles — cache par périmètre', () => {
  it('le second appel au même périmètre ne relit pas la base', async () => {
    expect(await getCategoriesVisibles(['s1', 's2'])).toEqual(CATALOGUE);
    const apresPremier = lectures;
    expect(apresPremier).toBeGreaterThan(0);
    // Même périmètre dans un autre ordre : même empreinte.
    expect(await getCategoriesVisibles(['s2', 's1'])).toEqual(CATALOGUE);
    expect(lectures).toBe(apresPremier);
  });

  it('un autre périmètre relit la base', async () => {
    await getCategoriesVisibles(['s1']);
    const apresPremier = lectures;
    await getCategoriesVisibles(['s3']);
    expect(lectures).toBeGreaterThan(apresPremier);
  });

  it('une lecture en échec n est pas mise en cache', async () => {
    echec = true;
    await getDistinctCategories(); // global déjà en cache : sans effet
    expect(await getCategoriesVisibles(['s1'])).toEqual([]);
    echec = false;
    expect(await getCategoriesVisibles(['s1'])).toEqual(CATALOGUE);
  });

  it('invalidateCategoriesCache vide aussi le cache par périmètre', async () => {
    await getCategoriesVisibles(['s1']);
    invalidateCategoriesCache();
    await getDistinctCategories();
    lectures = 0;
    await getCategoriesVisibles(['s1']);
    expect(lectures).toBeGreaterThan(0);
  });

  it('strict relit toujours la base (l aperçu d un espace ne doit pas mentir)', async () => {
    await getCategoriesVisibles(['s1']);
    const apresPremier = lectures;
    await getCategoriesVisibles(['s1'], { strict: true });
    expect(lectures).toBeGreaterThan(apresPremier);
  });

  it('le cache est borné en taille', async () => {
    for (let i = 0; i < 300; i++) await getCategoriesVisibles([`s${i}`]);
    // La toute première entrée a été évincée : la relire coûte des lectures.
    lectures = 0;
    await getCategoriesVisibles(['s0']);
    expect(lectures).toBeGreaterThan(0);
    // La plus récente est toujours là.
    lectures = 0;
    await getCategoriesVisibles(['s299']);
    expect(lectures).toBe(0);
  });
});
