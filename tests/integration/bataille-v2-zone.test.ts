/**
 * POST /api/isochrone-battle-v2 avec `zone_id` contre la VRAIE base locale (④ finitions, T3, arbitrage A-6) : la
 * bataille porte sur les POI d'une catégorie situés DANS une zone enregistrée de l'espace (`poi_de_zone`, sql/297), les
 * filtres de ① ignorés. Seules la session et la vue des sources sont simulées (l'espace Marine).
 *
 * Ce que ce fichier prouve :
 *   - CIRFA sur la région Bretagne (zone de test) : tous les POI rendus sont dans la zone ;
 *   - une zone d'un autre espace → 404 « Zone introuvable dans cet espace. », AVANT le flux (aucun POI lu) ;
 *   - une zone pays → la phrase d'A-6 ;
 *   - la clé de cache porte `__z<id>_<version>` et finit par `__p<empreinte>` ; une zone recalculée change de clé.
 *
 * Les zones de test (Marine et BMW) et les résultats complets écrits dans `isochrones_cache` sont effacés en `afterAll`.
 * Aucune bataille de plus de 300 anneaux (CIRFA de Bretagne × 3 paliers).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { creerClientTest } from './_client';
import { psql } from './_psql';

let espaceActif: string | null = null;
vi.mock('@/lib/auth/getSessionOrg', async (original) => ({
  ...(await original<typeof import('@/lib/auth/getSessionOrg')>()),
  getSessionOrg: async () => (espaceActif ? { userId: 'essai-bataille-zone', orgId: espaceActif, role: 'client' } : null),
}));
vi.mock('@/lib/api/middleware', async (original) => ({
  ...(await original<typeof import('@/lib/api/middleware')>()),
  requireAuth: async () => (espaceActif ? { id: 'essai-bataille-zone', role: 'client', organization_id: espaceActif } : null),
}));

const { POST } = await import('@/app/api/isochrone-battle-v2/route');
const sb = creerClientTest();

interface Ligne {
  type: string; message?: string;
  data?: { nb_pois: number; battleCacheKey?: string; fromCache?: boolean; poisForMap?: { id: string; lat: number; lng: number }[] };
}

const clesEcrites = new Set<string>();
const zonesCreees: string[] = [];
let marine = '';
let bmw = '';
let bretagne = '';
let zoneBmw = '';
let pays = '';
let paysMoins = '';

function appel(corps: Record<string, unknown>) {
  return POST(new NextRequest('http://localhost:3000/api/isochrone-battle-v2', {
    method: 'POST', body: JSON.stringify({ force_battle: true, ...corps }), headers: { 'content-type': 'application/json' },
  }));
}

async function bataille(corps: Record<string, unknown>): Promise<Ligne[]> {
  const res = await appel(corps);
  expect(res.status).toBe(200);
  const lignes = (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Ligne);
  for (const l of lignes) if (l.type === 'result' && l.data?.battleCacheKey) clesEcrites.add(l.data.battleCacheKey);
  return lignes;
}

/** Une zone figée « dessin » faite du périmètre de ① résolu en base, dans l'espace donné. */
function zoneDuPerimetre(nom: string, org: string, type: string, code: string): string {
  const id = psql(`select public.creer_zone_recette('${nom}', '${org}', null, '{"v":1,"type":"dessin"}', ST_AsGeoJSON(r.g))->>'id'
                     from public.resoudre_perimetre('${type}', '${code}', null, 100000, array['region', 'departement']) r;`);
  zonesCreees.push(id);
  return id;
}

beforeAll(async () => {
  const { data, error } = await sb.from('organizations').select('id, slug').in('slug', ['marine', 'bmw-group']);
  if (error) throw new Error(error.message);
  marine = (data ?? []).find((o) => o.slug === 'marine')?.id as string;
  bmw = (data ?? []).find((o) => o.slug === 'bmw-group')?.id as string;
  if (!marine || !bmw) throw new Error('espaces `marine` et `bmw-group` attendus en base locale');
  bretagne = zoneDuPerimetre('[ESSAI ④ T3] Bretagne', marine, 'region', '53');
  zoneBmw = zoneDuPerimetre('[ESSAI ④ T3] Bouches-du-Rhône', bmw, 'departement', '13');
  const { data: forme, error: e2 } = await sb.rpc('zone_pays_geometrie', { p_code: 'METRO' });
  if (e2) throw new Error(e2.message);
  const { data: cree, error: e3 } = await sb.rpc('creer_zone_recette', {
    p_nom: '[ESSAI ④ T3] France métropolitaine', p_org_id: marine, p_cree_par: null, p_recette: { v: 1, type: 'pays', code: 'METRO' },
    p_geometry_geojson: JSON.stringify((forme as { geometry: unknown }).geometry),
  });
  if (e3) throw new Error(e3.message);
  pays = (cree as { id: string }).id;
  zonesCreees.push(pays);
  // C21 round 1 : France métropolitaine moins la Bretagne (sql/326), créée comme le fait POST /api/zones.
  const { data: diff, error: e4 } = await sb.rpc('zone_difference', { p_base: pays, p_retires: [bretagne] });
  if (e4) throw new Error(e4.message);
  const { data: cree2, error: e5 } = await sb.rpc('creer_zone_recette', {
    p_nom: '[ESSAI C21] France métropolitaine moins la Bretagne', p_org_id: marine, p_cree_par: null,
    p_recette: { v: 1, type: 'combinaison', operation: 'difference', zones: [pays, bretagne] },
    p_geometry_geojson: JSON.stringify((diff as { geometry: unknown }).geometry),
  });
  if (e5) throw new Error(e5.message);
  paysMoins = (cree2 as { id: string }).id;
  zonesCreees.unshift(paysMoins);  // supprimée avant ses opérandes
}, 120_000);

afterAll(async () => {
  if (clesEcrites.size) {
    const { error, count } = await sb.from('isochrones_cache').delete({ count: 'exact' }).in('cache_key', [...clesEcrites]);
    if (error) throw new Error(`nettoyage du cache : ${error.message}`);
    expect(count).toBe(clesEcrites.size);
  }
  if (zonesCreees.length) {
    const { error, count } = await sb.from('custom_geo_zones').delete({ count: 'exact' }).in('id', zonesCreees);
    if (error) throw new Error(`nettoyage des zones : ${error.message}`);
    expect(count).toBe(zonesCreees.length);
  }
});

describe('bataille V2 sur une zone enregistrée (sql/297)', () => {
  it('CIRFA sur la zone Bretagne : tous les POI rendus sont dans la zone, les filtres de ① ignorés', async () => {
    espaceActif = marine;
    // Un filtre de ① contradictoire (département 13) : ignoré sur une zone.
    const l = await bataille({ category: 'cirfa', zone_id: bretagne, filtre_depts: ['13'], paliers: [10, 20, 30] });
    expect(l.filter((x) => x.type === 'error')).toEqual([]);
    const r = l.at(-1)!;
    expect(r.type).toBe('result');
    const pois = r.data!.poisForMap!;
    expect(pois.length).toBeGreaterThanOrEqual(2);
    const dehors = psql(`select count(*) from jsonb_to_recordset('${JSON.stringify(pois)}'::jsonb) p(lat float8, lng float8),
                                public.custom_geo_zones z
                          where z.id = '${bretagne}' and not ST_Intersects(z.geometry, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326));`);
    expect(dehors).toBe('0');
    // Les CIRFA de la zone, ni plus ni moins (la règle de la RPC, recomptée ici).
    const attendus = psql(`select count(*) from public.poi_france p, public.custom_geo_zones z
                            where z.id = '${bretagne}' and p.categorie = 'cirfa' and ST_Intersects(p.geom, z.geometry);`);
    expect(r.data!.nb_pois).toBe(Number(attendus));
  }, 120_000);

  it('la clé de cache porte la zone et sa version, et garde l’empreinte des sources en suffixe', async () => {
    espaceActif = marine;
    const l = await bataille({ category: 'cirfa', zone_id: bretagne, paliers: [10, 20, 30] });
    const cle = l.at(-1)!.data!.battleCacheKey!;
    expect(cle).toContain(`__z${bretagne}_`);
    expect(cle).toMatch(/__p[0-9a-f]{12}$/);
  }, 120_000);

  it('une zone recalculée (updated_at changé) produit une autre clé : jamais la bataille de l’ancienne forme', async () => {
    espaceActif = marine;
    const avant = (await bataille({ category: 'cirfa', zone_id: bretagne, paliers: [10, 20, 30] })).at(-1)!.data!.battleCacheKey!;
    psql(`update public.custom_geo_zones set name = name where id = '${bretagne}';`);
    const apres = (await bataille({ category: 'cirfa', zone_id: bretagne, paliers: [10, 20, 30] })).at(-1)!.data!.battleCacheKey!;
    expect(apres).not.toBe(avant);
  }, 120_000);

  it('zone d’un autre espace → 404 « Zone introuvable dans cet espace. », avant le flux', async () => {
    espaceActif = marine;
    const res = await appel({ category: 'cirfa', zone_id: zoneBmw, paliers: [10] });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ error: 'Zone introuvable dans cet espace.', refus: 'zone_introuvable' });
  });

  it('zone pays → la phrase d’A-6', async () => {
    espaceActif = marine;
    const res = await appel({ category: 'cirfa', zone_id: pays, paliers: [10] });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('Sur toute la France, la bataille se lance depuis l’étape ① (France métropolitaine).');
  });

  it('C21 : zone nationale moins zones locales → la même phrase de zone nationale, pas zone_trop_vaste', async () => {
    espaceActif = marine;
    const res = await appel({ category: 'cirfa', zone_id: paysMoins, paliers: [10] });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: 'Sur toute la France, la bataille se lance depuis l’étape ① (France métropolitaine).', refus: 'zone_pays',
    });
  });

  it('sans session → 401', async () => {
    espaceActif = null;
    expect((await appel({ category: 'cirfa', zone_id: bretagne, paliers: [10] })).status).toBe(401);
  });
});
