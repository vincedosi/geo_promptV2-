/**
 * Finitions de ③ Zones (plan 2026-10-29-carte-en-parcours-zones, Groupe A).
 *
 * T1 — seuil sur carreaux : un carreau de moins de N ménages (valeurs IMPUTÉES par l'INSEE sous 11 ménages, secret
 * statistique) peut être écarté ; une zone d'avant le lot (recette sans `min_menages`) se recalcule À L'IDENTIQUE.
 * Chiffres mesurés le 29/10 sur la base locale (Gironde, ménages pauvres ≥ 40 %) : 732 carreaux et 29,28 km² sans
 * minimum, 191 carreaux à 11 ménages (244 des 732 ont moins d'UN ménage). Codes de département normalisés à l'entrée.
 *
 * T2 — « Dupliquer » (`POST /api/zones/[id]/dupliquer`, sql/294) contre la vraie base : seuls l'appelant et le quota
 * sont simulés (le quota partagé et son 429 sont prouvés en unitaire, `zones-dupliquer-route.test.ts`). Deux espaces
 * `[ESSAI ③ finitions]` sont créés puis supprimés ; leurs zones partent avec eux.
 *
 * T3 — migration des 93 zones CIRFA de `geography_zones` (avril 2026) vers « Mes zones » de la Marine nationale
 * (sql/293) : rejouable, la table source intacte.
 */
import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { creerClientTest } from './_client';
import { readFileSync } from 'node:fs';
import { psql, psqlBrut } from './_psql';
import { executerRecette } from '@/lib/zones/executer-recette';
import { lireRecette } from '@/lib/zones/recette-schema';

const appelant = vi.hoisted(() => ({ id: '', org: '' }));
vi.mock('@/lib/api/middleware', async (original) => ({
  ...(await original<typeof import('@/lib/api/middleware')>()),
  requireAuth: async () => ({ id: appelant.id, role: 'client', organization_id: appelant.org }),
}));
vi.mock('@/lib/api/rate-limit', async (original) => ({
  ...(await original<typeof import('@/lib/api/rate-limit')>()),
  createQuota: () => async () => null,
}));

const admin = creerClientTest();
type ClientAdmin = Parameters<typeof executerRecette>[0];

interface Zone { vide: boolean; compte: number; surface_km2: number; population: number }

describe('T1 — seuil sur carreaux : minimum de ménages', () => {
  const GIRONDE = {
    p_indicateur: 'part_men_pauv', p_operateur: '>=', p_seuil: 40, p_perimetre_type: 'departement',
    p_perimetre_code: '33', p_org_id: null,
  };

  it('l’enveloppe historique (zones d’avant le lot) rend la même forme qu’avant : 732 carreaux, 29,28 km²', async () => {
    const { data, error } = await admin.rpc('zone_seuil_carreaux', GIRONDE);
    expect(error).toBeNull();
    const z = data as Zone;
    expect([z.compte, z.surface_km2]).toEqual([732, 29.28]);
  });

  it('la jumelle à 0 ménage est la même zone que l’enveloppe', async () => {
    const { data, error } = await admin.rpc('zone_seuil_carreaux_min', { ...GIRONDE, p_min_menages: 0 });
    expect(error).toBeNull();
    const z = data as Zone;
    expect([z.compte, z.surface_km2]).toEqual([732, 29.28]);
  });

  it('à 11 ménages : 191 carreaux, et aucun carreau de moins de 11 ménages dans la forme', async () => {
    const { data, error } = await admin.rpc('zone_seuil_carreaux_min', { ...GIRONDE, p_min_menages: 11 });
    expect(error).toBeNull();
    expect((data as Zone).compte).toBe(191);
    // Trois carreaux retenus à 0 et écartés à 11 (0,4 ; 10,6 ; 10,2 ménages) et un carreau de 11 ménages tout juste,
    // retenu (la borne est INCLUSE). Par le centroïde, comme la règle de la RPC.
    const dans = psql(`
      with z as (select st_geomfromgeojson(public.zone_seuil_carreaux_min('part_men_pauv', '>=', 40, 'departement', '33',
                   null, 11)->>'geometry') g)
      select string_agg(cf.id || ':' || st_intersects(st_transform(st_centroid(cf.geom_3857), 4326), z.g), ',' order by cf.id)
        from public.carreaux_filosofi cf, z where cf.id in (46507, 454903, 1208980, 258312);`);
    expect(dans).toBe('46507:false,258312:true,454903:false,1208980:false');
  });

  it('minimum hors bornes (négatif, au-delà de 1 000, NULL) : 22023', async () => {
    for (const p_min_menages of [-1, 1001, null]) {
      const { error } = await admin.rpc('zone_seuil_carreaux_min', { ...GIRONDE, p_min_menages });
      expect(error?.code, String(p_min_menages)).toBe('22023');
    }
  });

  it('l’exécuteur passe le minimum de la recette enregistrée, et 0 quand la recette n’en porte pas', async () => {
    const lue = lireRecette({ v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 40, perimetre: { type: 'departement', code: '33' } });
    if (!lue.ok) throw new Error(lue.message);
    const sans = await executerRecette(admin as unknown as ClientAdmin, lue.recette, { orgId: '00000000-0000-0000-0000-000000000000', sources: [] });
    const avec = await executerRecette(admin as unknown as ClientAdmin, { ...lue.recette, min_menages: 11 } as typeof lue.recette, { orgId: '00000000-0000-0000-0000-000000000000', sources: [] });
    expect(sans.ok && sans.compte).toBe(732);
    expect(avec.ok && avec.compte).toBe(191);
  });
});

describe('T1 — codes de territoire normalisés à l’entrée (V-8)', () => {
  it('seuil sur territoires en « 2a » tapé avec espaces : le même résultat qu’en « 2A »', async () => {
    const recette = (code: string) => {
      const r = lireRecette({ v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>=', seuil: 20, perimetre: { type: 'departement', code } });
      if (!r.ok) throw new Error(r.message);
      return r.recette;
    };
    const ctx = { orgId: '00000000-0000-0000-0000-000000000000', sources: [], indicateurs: new Set(['taux_pauvrete']) };
    const propre = await executerRecette(admin as unknown as ClientAdmin, recette('2A'), ctx);
    const tape = await executerRecette(admin as unknown as ClientAdmin, recette(' 2a '), ctx);
    expect(propre.ok).toBe(true);
    expect(tape).toEqual(propre);
  });
});

describe('T2 — dupliquer une zone', () => {
  const route = import('@/app/api/zones/[id]/dupliquer/route');
  const dupliquer = async (id: string, corps: unknown) => (await route).POST(
    new NextRequest(`http://localhost/api/zones/${id}/dupliquer`, { method: 'POST', body: JSON.stringify(corps), headers: { 'content-type': 'application/json' } }),
    { params: Promise.resolve({ id }) },
  );
  const CARRE = JSON.stringify({ type: 'Polygon', coordinates: [[[5.36, 43.29], [5.40, 43.29], [5.40, 43.32], [5.36, 43.32], [5.36, 43.29]]] });
  const RAYON = { v: 1, type: 'rayon_point', lon: 5.38, lat: 43.30, rayon_m: 2000 };
  let org = '';
  let autreOrg = '';

  async function nouvelleOrg(nom: string) {
    const { data, error } = await admin.from('organizations')
      .insert({ name: `[ESSAI ③ finitions] ${nom}`, slug: `essai-finitions-${nom}-${Date.now()}` }).select('id').single();
    if (error || !data) throw new Error(error?.message);
    return data.id as string;
  }
  async function creer(recette: unknown, o = org, geometrie = CARRE) {
    const { data, error } = await admin.rpc('creer_zone_recette', { p_nom: 'Source', p_org_id: o, p_cree_par: null, p_recette: recette, p_geometry_geojson: geometrie });
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  }
  const ligne = (id: string) => psql(`select name || '|' || source_type || '|' || round(st_area(geometry::geography)) || '|' || coalesce(recette::text, 'null')
    || '|' || coalesce(source_metadata->>'duplique_de', '') || '|' || updated_at from public.custom_geo_zones where id = '${id}';`);

  beforeAll(async () => {
    org = await nouvelleOrg('a');
    autreOrg = await nouvelleOrg('b');
    appelant.org = org;
    appelant.id = psql('select id from auth.users order by created_at limit 1;');
  });
  afterAll(async () => {
    for (const o of [org, autreOrg]) {
      const { error } = await admin.from('organizations').delete().eq('id', o);
      if (error) throw new Error(`nettoyage : ${error.message}`);
    }
  });

  it('forme figée : une NOUVELLE zone, même surface, recette et sous-zones copiées, duplique_de ; la source intacte', async () => {
    const source = await creer({ v: 1, type: 'dessin' });
    const { error: e } = await admin.from('custom_geo_zone_subzones')
      .insert({ zone_id: source, name: 'Palier 1', geometry: 'SRID=4326;MULTIPOLYGON(((5.36 43.29,5.38 43.29,5.38 43.30,5.36 43.30,5.36 43.29)))' });
    expect(e).toBeNull();
    const avant = ligne(source);
    const res = await dupliquer(source, { nom: 'Source (copie)' });
    expect([200, 207]).toContain(res.status);
    const id = ((await res.json()) as { zone_id: string }).zone_id;
    expect(id).not.toBe(source);
    const [nom, type, aire, recette, de] = ligne(id).split('|');
    const [, typeS, aireS, recetteS] = avant.split('|');
    expect([nom, type, aire, recette, de]).toEqual(['Source (copie)', typeS, aireS, recetteS, source]);
    expect(psql(`select count(*) from public.custom_geo_zone_subzones where zone_id = '${id}';`)).toBe('1');
    expect(ligne(source)).toBe(avant);
    expect(psql(`select org_id from public.custom_geo_zones where id = '${id}';`)).toBe(org);
  });

  it('recette recalculable CITÉE (A-2) : nouvelle zone calculée à neuf, l’originale ne bouge pas (updated_at identique)', async () => {
    // La forme stockée (le carré) n'est PAS celle de la recette (un disque de 2 km) : la copie doit être le disque.
    const source = await creer(RAYON);
    const b = await creer({ v: 1, type: 'dessin' });
    await creer({ v: 1, type: 'combinaison', operation: 'union', zones: [source, b] });
    expect((await admin.rpc('zone_referencee', { p_zone_id: source })).data).toBe('combinaison');
    const avant = ligne(source);
    const res = await dupliquer(source, { nom: 'Rayon recalculé' });
    expect([200, 207]).toContain(res.status);
    const id = ((await res.json()) as { zone_id: string }).zone_id;
    expect(ligne(source)).toBe(avant);
    const [, type, aire, recette, de] = ligne(id).split('|');
    expect(type).toBe('recette_rayon_point');
    expect(JSON.parse(recette)).toEqual(RAYON);
    expect(de).toBe(source);
    // La forme de la copie est celle que la recette rend AUJOURD'HUI (le disque découpé sur la côte), pas le carré stocké.
    const disque = psql(`select round(st_area(st_geomfromgeojson(public.zone_rayon(5.38, 43.30, 2000)->>'geometry')::geography));`);
    expect(aire).toBe(disque);
    expect(aire).not.toBe(ligne(source).split('|')[2]);
  });

  it('zone d’un autre espace : 404, comme inconnue ; rien d’écrit', async () => {
    const etrangere = await creer({ v: 1, type: 'dessin' }, autreOrg);
    const avant = psql(`select count(*) from public.custom_geo_zones where org_id in ('${org}', '${autreOrg}');`);
    const res = await dupliquer(etrangere, { nom: 'Vol' });
    expect(res.status).toBe(404);
    expect(psql(`select count(*) from public.custom_geo_zones where org_id in ('${org}', '${autreOrg}');`)).toBe(avant);
  });

  it('nom vide : 400', async () => {
    const source = await creer({ v: 1, type: 'dessin' });
    expect((await dupliquer(source, { nom: '  ' })).status).toBe(400);
  });
});

describe('T3 — les 93 zones CIRFA rejoignent les zones de la Marine nationale (sql/293)', () => {
  const ORIGINE = `source_metadata->>'origine' = 'geography_zones'`;
  const marine = () => psql(`select id from public.organizations where name = 'Marine nationale';`);
  const empreinteSource = () => psql('select count(*) || \'|\' || round(sum(st_area(geom::geography))) || \'|\' || max(created_at) from public.geography_zones;');

  it('93 zones dans l’espace Marine nationale, aucune ailleurs ; forme identique à la source', () => {
    expect(psql(`select count(*) from public.custom_geo_zones where ${ORIGINE} and org_id = '${marine()}';`)).toBe('93');
    expect(psql(`select count(*) from public.custom_geo_zones where ${ORIGINE} and org_id <> '${marine()}';`)).toBe('0');
    // Chaque zone a la géométrie de SA ligne source (aucune résolution de codes : compteurs à 0, A-11).
    expect(psql(`select count(*) from public.custom_geo_zones z join public.geography_zones g on g.id = (z.source_metadata->>'geography_zone_id')::uuid
                  where z.${ORIGINE} and st_equals(z.geometry, g.geom) and z.name = g.name and z.feature_count_cp = 0;`)).toBe('93');
  });

  it('la recette écrite est une recette VALIDE pour le schéma serveur (sinon « Mes zones » la lirait illisible)', () => {
    const recettes = psql(`select jsonb_agg(distinct recette) from public.custom_geo_zones where ${ORIGINE};`);
    const liste = JSON.parse(recettes) as unknown[];
    // Deux recettes distinctes mesurées le 29/10 : 76 CIRFA au palier maximal de 60 min, 17 à 30 min.
    expect(liste.length).toBeGreaterThan(0);
    for (const r of liste) {
      const lue = lireRecette(r);
      expect(lue.ok, JSON.stringify(r)).toBe(true);
      expect(lue.ok && lue.recette.type).toBe('isochrone');
    }
  });

  it('rejouer la migration n’ajoute rien, et geography_zones n’est pas touchée', () => {
    const avant = empreinteSource();
    const r = psqlBrut(readFileSync('sql/293_cirfa_vers_zones.sql', 'utf8'));
    expect(r.status, r.stderr).toBe(0);
    expect(psql(`select count(*) from public.custom_geo_zones where ${ORIGINE};`)).toBe('93');
    expect(empreinteSource()).toBe(avant);
    expect(avant.split('|')[0]).toBe('93');
  });
});
