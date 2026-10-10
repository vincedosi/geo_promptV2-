/**
 * Outil copilote `voronoi_analysis` : plus de plafond silencieux à 1 000 cellules.
 *
 * `get_voronoi_by_category` est `RETURNS SETOF json` : PostgREST la coupe à
 * `db-max-rows` = 1 000 sans erreur. Mesuré le 2026-10-10 sur les lycées de
 * métropole : 4 653 cellules en base, 1 000 rendues. L'outil lit désormais la
 * jumelle `get_voronoi_by_category_jsonb` (sql/246), qui rend tout jusqu'à sa
 * borne et dit `tronque`.
 *
 * Le faux client reproduit le plafond : la forme SETOF rend au plus 1 000
 * lignes, la jumelle rend `{ features, tronque }`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const MAX_ROWS = 1000;
let cellules = 0;
const appels: { nom: string; args: Record<string, unknown> }[] = [];

const feature = (i: number) => ({
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [] },
  properties: { id: `l${i}`, nom: `Lycée ${i}`, categorie: 'lycee', lat: 45 + i / 10000, lng: 4 + i / 10000 },
});

vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    rpc: async (nom: string, args: Record<string, unknown> = {}) => {
      appels.push({ nom, args });
      const toutes = Array.from({ length: cellules }, (_, i) => feature(i));
      if (nom === 'get_voronoi_by_category') return { data: toutes.slice(0, MAX_ROWS), error: null };
      if (nom === 'get_voronoi_by_category_jsonb') {
        const limite = Number(args.p_limite ?? 5000);
        return { data: { features: toutes.slice(0, limite), tronque: toutes.length > limite }, error: null };
      }
      return { data: null, error: { message: `RPC inattendue ${nom}` } };
    },
  }),
}));
vi.mock('@/lib/auth/perimetre-donnees', () => ({ categorieEntierementVisible: async () => true }));
vi.mock('@/lib/chat/tools/orgContext', () => ({ getOrgSourceIds: () => null }));

const { voronoiAnalysis } = await import('@/lib/chat/tools/voronoi');

beforeEach(() => {
  cellules = 0;
  appels.length = 0;
});

describe('voronoi_analysis — plafond PostgREST', () => {
  it('rend les 4 653 cellules des lycées, pas les 1 000 premières', async () => {
    cellules = 4653;
    const r = await voronoiAnalysis({ category: 'lycee' }, []) as { nb_polygones: number; tronque: boolean };
    expect(r.nb_polygones).toBe(4653);
    expect(r.tronque).toBe(false);
  });

  it('UN appel à la jumelle jsonb, borne écrite (5 000), jamais la forme SETOF', async () => {
    cellules = 10;
    await voronoiAnalysis({ category: 'lycee' }, []);
    expect(appels.map((a) => a.nom)).toEqual(['get_voronoi_by_category_jsonb']);
    expect(appels[0].args).toMatchObject({ cat_name: 'lycee', metropolitaine: true, p_limite: 5000 });
  });

  it('borne atteinte : le dit (tronque), au lieu de présenter un début comme le compte', async () => {
    cellules = 5001;
    const r = await voronoiAnalysis({ category: 'arret_transport' }, []) as { nb_polygones: number; tronque: boolean };
    expect(r.nb_polygones).toBe(5000);
    expect(r.tronque).toBe(true);
  });
});
