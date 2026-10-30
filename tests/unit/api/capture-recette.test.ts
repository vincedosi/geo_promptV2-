import { describe, it, expect, vi, beforeEach } from 'vitest';

/** La capture (route partagée avec React) garde une recette FIGÉE quand l'Angular en envoie une (lot 3, L3-5). */
const ORG = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
vi.mock('@/lib/api/middleware', () => ({
  requireAuth: async () => ({ id: 'u1', role: 'super_admin', organization_id: ORG }),
  authUnauthorized: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/campaigns/access', () => ({ resolveOrgWriteAccess: () => true }));
const CARRE = { type: 'MultiPolygon', coordinates: [[[[5, 43], [5.1, 43], [5.1, 43.1], [5, 43.1], [5, 43]]]] };
const rpcs: string[] = [];
/** Les arguments de chaque RPC, pour lire les sous-zones envoyées à la création (preuve T7, D-1). */
const argsRpc: { nom: string; args: Record<string, unknown> }[] = [];
/** L'ordre des appels, RPC et écriture de recette mêlées : la recette doit précéder la résolution (P6). */
const appels: string[] = [];
const miseAJour: { valeur: unknown; id: unknown }[] = [];
let echecUpdate = false;
let echecResolution = false;
vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    rpc(nom: string, args: Record<string, unknown> = {}) {
      rpcs.push(nom);
      argsRpc.push({ nom, args });
      appels.push(nom);
      if (nom === 'resolve_custom_geo_zone_codes' && echecResolution) return Promise.resolve({ data: null, error: { message: 'délai' } });
      const data = ({
        transform_geometries_for_save: CARRE, create_custom_geo_zone: 'z1', create_custom_geo_zone_with_subzones: 'z1',
        resolve_custom_geo_zone_codes: { count_cp: 2, count_iris: 5 }, compute_zone_audience_stats: {},
        resolve_custom_geo_zone_codes_with_subzones: { count_cp: 2, count_iris: 5 },
      } as Record<string, unknown>)[nom] ?? null;
      return Promise.resolve({ data, error: null });
    },
    from(table: string) {
      return {
        update(valeur: unknown) {
          return {
            eq(_c: string, id: unknown) {
              appels.push(`update:${table}`);
              miseAJour.push({ valeur, id });
              return Promise.resolve({ error: echecUpdate ? { message: 'x' } : null });
            },
          };
        },
      };
    },
  }),
}));
const { POST } = await import('@/app/api/custom-geo/capture/route');

const corps = (extra: Record<string, unknown> = {}) => new Request('http://localhost/api/custom-geo/capture', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Bataille', org_id: ORG, source_type: 'isochrone_battle', geometries: [CARRE], transformation: 'union', ...extra }),
}) as never;
const ISO = { v: 1, type: 'isochrone', parametres: { mode: 'drive', minutes: 15, version: 'v2' } };

beforeEach(() => {
  rpcs.length = 0; argsRpc.length = 0; appels.length = 0; miseAJour.length = 0; echecUpdate = false; echecResolution = false;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('POST /api/custom-geo/capture — recette facultative', () => {
  it('sans recette : comportement d’avant (React), aucune écriture de recette', async () => {
    const r = await POST(corps());
    expect(r.status).toBe(200);
    expect(rpcs).toEqual(['transform_geometries_for_save', 'create_custom_geo_zone', 'resolve_custom_geo_zone_codes', 'compute_zone_audience_stats']);
    expect(miseAJour).toEqual([]);
  });
  it('recette isochrone : écrite sur la zone créée, AVANT la résolution des codes', async () => {
    const r = await POST(corps({ recette: ISO }));
    expect(r.status).toBe(200);
    expect(miseAJour).toEqual([{ valeur: { recette: ISO }, id: 'z1' }]);
    expect(appels).toEqual(['transform_geometries_for_save', 'create_custom_geo_zone', 'update:custom_geo_zones', 'resolve_custom_geo_zone_codes', 'compute_zone_audience_stats']);
  });
  it('recette capture : acceptée telle quelle', async () => {
    const recette = { v: 1, type: 'capture', source_type: 'voronoi_cells' };
    const r = await POST(corps({ recette }));
    expect(r.status).toBe(200);
    expect(miseAJour).toEqual([{ valeur: { recette }, id: 'z1' }]);
  });
  it('recette d’un type recalculable : 400, rien n’est créé', async () => {
    const r = await POST(corps({ recette: { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 5000, perimetre: null } }));
    expect(r.status).toBe(400);
    expect(rpcs).toEqual([]);
  });
  it('recette mal formée : 400, rien n’est créé', async () => {
    const r = await POST(corps({ recette: { v: 1, type: 'isochrone' } }));
    expect(r.status).toBe(400);
    expect(rpcs).toEqual([]);
  });
  it('écriture de la recette en échec : 207, la zone existe', async () => {
    echecUpdate = true;
    const r = await POST(corps({ recette: ISO }));
    expect(r.status).toBe(207);
    expect(await r.json()).toEqual({
      zone_id: 'z1', warning: 'recette_non_enregistree', count_iris: 5, count_cp: 2,
      message: 'Zone sauvegardée, mais sa recette n’a pas pu être enregistrée.',
    });
  });
  it('résolution des codes en échec : 207 « zone créée », et la recette est DÉJÀ écrite (P6)', async () => {
    echecResolution = true;
    const r = await POST(corps({ recette: ISO }));
    expect(r.status).toBe(207);
    expect(await r.json()).toEqual({
      zone_id: 'z1', warning: 'zone_created_but_resolution_failed', message: 'Zone créée ; ses codes postaux n’ont pas pu être résolus.',
    });
    expect(miseAJour).toEqual([{ valeur: { recette: ISO }, id: 'z1' }]);
  });
  it('les deux échecs ensemble : un seul 207, dont le message dit les deux', async () => {
    echecResolution = true;
    echecUpdate = true;
    const r = await POST(corps({ recette: ISO }));
    expect(r.status).toBe(207);
    expect(await r.json()).toEqual({
      zone_id: 'z1', warning: 'zone_created_but_resolution_failed', recette_non_enregistree: true,
      message: 'Zone créée ; ses codes postaux n’ont pas pu être résolus, et sa recette n’a pas été enregistrée.',
    });
  });
});

describe('POST /api/custom-geo/capture — sous-zones d’une bataille (③ finitions, preuve T7, D-1)', () => {
  const BANDE = (x: number) => ({ type: 'Polygon', coordinates: [[[x, 43], [x + 0.1, 43], [x + 0.1, 43.1], [x, 43.1], [x, 43]]] });
  it('une sous-zone à plusieurs `geometries` (bandes V2) : unies en base, la sous-zone écrite est l’union', async () => {
    const r = await POST(corps({
      subzones: [
        { name: 'A', source_ref: 'a', geometries: [BANDE(5), BANDE(5.1), BANDE(5.2)] },
        { name: 'B', source_ref: 'b', geometries: [BANDE(6)] },
      ],
    }));
    expect(r.status).toBe(200);
    const unions = argsRpc.filter((a) => a.nom === 'transform_geometries_for_save');
    // Une union pour la zone entière, puis une par sous-zone.
    expect(unions.map((u) => [(u.args['p_geometries'] as unknown[]).length, u.args['p_method']])).toEqual([[1, 'union'], [3, 'union'], [1, 'union']]);
    const creation = argsRpc.find((a) => a.nom === 'create_custom_geo_zone_with_subzones')!;
    const sz = creation.args['p_subzones'] as { name: string; geometry_geojson: string }[];
    expect(sz.map((s) => [s.name, JSON.parse(s.geometry_geojson)])).toEqual([['A', CARRE], ['B', CARRE]]);
  });
  it('une sous-zone à `geometry` unique (React) : envoyée telle quelle, sans union', async () => {
    const r = await POST(corps({ subzones: [{ name: 'A', geometry: BANDE(5) }, { name: 'B', geometry: BANDE(6) }] }));
    expect(r.status).toBe(200);
    expect(argsRpc.filter((a) => a.nom === 'transform_geometries_for_save')).toHaveLength(1);
    const sz = argsRpc.find((a) => a.nom === 'create_custom_geo_zone_with_subzones')!.args['p_subzones'] as { geometry_geojson: string }[];
    expect(JSON.parse(sz[0].geometry_geojson)).toEqual(BANDE(5));
  });
  it('une sous-zone sans géométrie : 400, rien n’est créé', async () => {
    const r = await POST(corps({ subzones: [{ name: 'A' }] }));
    expect(r.status).toBe(400);
    expect(rpcs).toEqual([]);
  });
});
