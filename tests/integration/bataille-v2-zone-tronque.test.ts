/**
 * La branche `tronque` de `poi_de_zone` (sql/297) et son refus par `POST /api/isochrone-battle-v2` (④ finitions,
 * relecture 1 du groupe A, point 6), contre la VRAIE base locale.
 *
 * Aucune catégorie de la base ne dépasse 500 POI dans une zone de test en un temps raisonnable : la RPC est appelée
 * avec `p_limite = 1`, et la route avec un plafond de lecture ramené à 1 (`PLAFOND_LECTURE_POI` simulé, le reste du
 * module réel). La zone Bretagne (région 53, espace Marine) porte plusieurs CIRFA : la lecture est donc tronquée.
 * La zone de test est effacée en `afterAll` ; aucune bataille n'est calculée (refus avant toute lecture du cache).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { creerClientTest } from './_client';
import { psql } from './_psql';

let marine = '';
vi.mock('@/lib/auth/getSessionOrg', async (original) => ({
  ...(await original<typeof import('@/lib/auth/getSessionOrg')>()),
  getSessionOrg: async () => ({ userId: 'essai-bataille-tronque', orgId: marine, role: 'client' }),
}));
vi.mock('@/lib/api/middleware', async (original) => ({
  ...(await original<typeof import('@/lib/api/middleware')>()),
  requireAuth: async () => ({ id: 'essai-bataille-tronque', role: 'client', organization_id: marine }),
}));
vi.mock('@/lib/isochrones/borne-nationale', async (original) => ({
  ...(await original<typeof import('@/lib/isochrones/borne-nationale')>()),
  PLAFOND_LECTURE_POI: 1,
}));

const { POST } = await import('@/app/api/isochrone-battle-v2/route');
const sb = creerClientTest();
let bretagne = '';

beforeAll(async () => {
  const { data, error } = await sb.from('organizations').select('id').eq('slug', 'marine').single();
  if (error || !data) throw new Error(error?.message ?? 'espace `marine` attendu en base locale');
  marine = data.id;
  bretagne = psql(`select public.creer_zone_recette('[ESSAI ④ relecture 1] Bretagne', '${marine}', null, '{"v":1,"type":"dessin"}',
                     ST_AsGeoJSON(r.g))->>'id' from public.resoudre_perimetre('region', '53', null, 100000, array['region']) r;`);
}, 60_000);

afterAll(async () => {
  if (!bretagne) return;
  const { error, count } = await sb.from('custom_geo_zones').delete({ count: 'exact' }).eq('id', bretagne);
  if (error) throw new Error(`nettoyage de la zone : ${error.message}`);
  expect(count).toBe(1);
});

describe('poi_de_zone — lecture tronquée', () => {
  it('p_limite = 1 sur une zone à plusieurs CIRFA : un POI rendu, `tronque: true`', async () => {
    const sources = psql(`select string_agg(distinct data_source_id::text, ',') from public.poi_france where categorie = 'cirfa';`).split(',');
    const { data, error } = await sb.rpc('poi_de_zone', { p_zone: bretagne, p_org: marine, p_categorie: 'cirfa', p_sources: sources, p_limite: 1 });
    if (error) throw new Error(error.message);
    const r = data as { pois: unknown[]; tronque: boolean };
    expect(r.pois).toHaveLength(1);
    expect(r.tronque).toBe(true);
    const assez = await sb.rpc('poi_de_zone', { p_zone: bretagne, p_org: marine, p_categorie: 'cirfa', p_sources: sources, p_limite: 500 });
    expect((assez.data as { pois: unknown[]; tronque: boolean }).tronque).toBe(false);
    expect((assez.data as { pois: unknown[] }).pois.length).toBeGreaterThan(1);
  });

  it('la route refuse une lecture tronquée, avant toute lecture du cache, avec sa phrase', async () => {
    const res = await POST(new NextRequest('http://localhost:3000/api/isochrone-battle-v2', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category: 'cirfa', zone_id: bretagne, paliers: [10, 20, 30], force_battle: true }),
    }));
    expect(res.status).toBe(200);
    const lignes = (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as { type: string; message?: string });
    expect(lignes).toEqual([{
      type: 'error',
      message: 'Plus de 1 POI « cirfa » dans la zone : ce calcul dépasse ce qu’on peut calculer en direct. Il se lancera '
        + 'en tâche de fond dès le lot « calculs longs » ; en attendant, choisissez une zone plus petite.',
    }]);
  });
});
