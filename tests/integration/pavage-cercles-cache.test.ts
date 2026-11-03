/**
 * D33 (sql/338) : le cache des pavages en cercles — `pavage_cercles_cache`, `pavage_cercles_en_cache`,
 * `paver_cercles_cache`. Les simulations de maille de ⑤ (B9, B16) pavent au rayon par défaut ; ce cache les garde par
 * (version de zone, cible, rayon, seuil, limites de la plateforme), comme sql/270 garde les couvertures par territoire.
 *
 * Ce que ce fichier prouve :
 *   - le premier appel pave (`cache: false`), le second est servi du cache (`cache: true`), mêmes chiffres ;
 *   - la PLATEFORME n'est pas dans la clé, ses limites le sont : un autre minimum par cercle ou un autre plafond ne lit
 *     pas la ligne ; un autre seuil ou un autre rayon non plus (un pavage ne se rejoue pas en mémoire) ;
 *   - accès croisé : l'id d'une zone en cache, depuis un autre espace, ne lit rien et n'écrit rien ;
 *   - la forme change, la base est reconstruite, ou `paver_cercles` est remplacée (md5) : la ligne n'est plus servie ;
 *   - seul un refus GÉOMÉTRIQUE (`zone_trop_vaste`) s'écrit et se sert ; `trop_de_cercles` (recherche de B10) ou une
 *     cible inconnue jamais ; la suppression de la zone emporte ses lignes (cascade).
 * Les changements de base et de fonction sont simulés par psql dans des transactions ANNULÉES (base locale partagée).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerClientTest } from './_client';
import { psql } from './_psql';

const admin = creerClientTest();
const LONG = 120_000;

interface Reponse { refus?: string; cache?: boolean; zone_maj?: string; n_cercles?: number; n_carreaux?: number; taux_utile?: number }

let org = '';
let autreOrg = '';
let zone = '';

async function nouvelleOrg(nom: string) {
  const { data, error } = await admin.from('organizations')
    .insert({ name: `[ESSAI D33] ${nom}`, slug: `essai-d33-${nom}-${Date.now()}` }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  return data.id as string;
}

const carre = (o: number, s: number, e: number, n: number) =>
  JSON.stringify({ type: 'Polygon', coordinates: [[[o, s], [e, s], [e, n], [o, n], [o, s]]] });
/** ≈ 5 km × 4 km au centre de Lyon : quelques cercles de 1 km, quelques centaines de ms. */
const LYON = carre(4.80, 45.74, 4.86, 45.78);
const LYON_PLUS_PETIT = carre(4.82, 45.75, 4.845, 45.765);

interface Cle { cible?: string; rayon?: number; seuil?: number; popMin?: number; max?: number | null }
const args = (z: string, o: string, c: Cle = {}) => ({
  p_zone_id: z, p_org_id: o, p_cible: c.cible ?? 'ind', p_rayon_m: c.rayon ?? 1000, p_seuil: c.seuil ?? 20,
  p_pop_min: c.popMin ?? 0, ...(c.max === undefined || c.max === null ? {} : { p_max_cercles: c.max }),
});

async function enCache(z: string, o: string, c: Cle = {}): Promise<Reponse | null> {
  const { data, error } = await admin.rpc('pavage_cercles_en_cache', args(z, o, c));
  if (error) throw new Error(`${error.code} ${error.message}`);
  return data as Reponse | null;
}

async function paver(z: string, o: string, c: Cle = {}): Promise<Reponse> {
  const { data, error } = await admin.rpc('paver_cercles_cache', args(z, o, c));
  if (error) throw new Error(`${error.code} ${error.message}`);
  return data as Reponse;
}

const lignes = (z: string) => Number(psql(`select count(*) from public.pavage_cercles_cache where zone_id = '${z}';`));

beforeAll(async () => {
  org = await nouvelleOrg('a');
  autreOrg = await nouvelleOrg('b');
  const { data, error } = await admin.rpc('creer_zone_recette', {
    p_nom: 'Lyon (D33)', p_org_id: org, p_cree_par: null, p_recette: { v: 1, type: 'dessin' }, p_geometry_geojson: LYON,
  });
  if (error) throw new Error(error.message);
  zone = (data as { id: string }).id;
}, LONG);

afterAll(async () => {
  for (const o of [org, autreOrg]) {
    if (!o) continue;
    const { error } = await admin.from('organizations').delete().eq('id', o);
    if (error) throw new Error(`nettoyage : ${error.message}`);
  }
});

describe('paver_cercles_cache — pavage puis cache', () => {
  it('rien au départ ; le premier appel pave, le second est servi du cache, mêmes chiffres que paver_cercles', async () => {
    expect(await enCache(zone, org)).toBeNull();
    const premier = await paver(zone, org);
    expect(premier.refus).toBeUndefined();
    expect(premier.cache).toBe(false);
    expect(premier.n_cercles).toBeGreaterThan(0);
    expect(lignes(zone)).toBe(1);

    const second = await paver(zone, org);
    expect(second.cache).toBe(true);
    expect({ ...second, cache: false }).toEqual(premier);
    const { data: brut } = await admin.rpc('paver_cercles', { p_zone_id: zone, p_org_id: org, p_cible: 'ind', p_rayon_m: 1000, p_seuil: 20, p_pop_min: 0 });
    // Seule la date du calcul (`calcule_le`) diffère d'un pavage refait.
    const { cache: _c, zone_maj: _m, calcule_le: _d, ...sansMarques } = premier as Record<string, unknown>;
    const { calcule_le: _d2, ...brutSansDate } = brut as Record<string, unknown>;
    expect(sansMarques).toEqual(brutSansDate);
  }, LONG);

  it('les limites de la plateforme sont dans la clé, pas son nom ; seuil et rayon aussi', async () => {
    await paver(zone, org);
    expect((await enCache(zone, org))?.cache).toBe(true);
    expect(await enCache(zone, org, { popMin: 1000 })).toBeNull();   // DV360 : minimum par cercle
    expect(await enCache(zone, org, { max: 200 })).toBeNull();       // Meta : plafond de cercles
    expect(await enCache(zone, org, { seuil: 30 })).toBeNull();
    expect(await enCache(zone, org, { rayon: 2000 })).toBeNull();
    expect(await enCache(zone, org, { cible: 'men_pauv' })).toBeNull();
    // Mêmes limites, quelle que soit la plateforme qui les porte : la même ligne.
    await paver(zone, org, { max: 200 });
    expect((await enCache(zone, org, { max: 200 }))?.cache).toBe(true);
  }, LONG);

  it('ni `cible_inconnue` ni `trop_de_cercles` (la recherche de B10 reste celle du moment) ne s’écrivent', async () => {
    const avant = lignes(zone);
    expect((await paver(zone, org, { cible: 'xxx' })).refus).toBe('cible_inconnue');
    expect((await paver(zone, org, { max: 1 })).refus).toBe('trop_de_cercles');
    expect(lignes(zone)).toBe(avant);
  }, LONG);

  it('un refus géométrique (`zone_trop_vaste`) s’écrit et se sert : il ne dépend que de la forme et du rayon', async () => {
    const { data, error } = await admin.rpc('creer_zone_recette', {
      p_nom: 'Trop vaste (D33)', p_org_id: org, p_cree_par: null, p_recette: { v: 1, type: 'dessin' },
      p_geometry_geojson: carre(-1, 44, 4, 48), // ≈ 178 000 km², au-delà des 100 000 km² du pavage
    });
    if (error) throw new Error(error.message);
    const vaste = (data as { id: string }).id;
    const premier = await paver(vaste, org);
    expect(premier).toMatchObject({ refus: 'zone_trop_vaste', cache: false });
    expect(lignes(vaste)).toBe(1);
    expect(await paver(vaste, org)).toMatchObject({ refus: 'zone_trop_vaste', cache: true });
  }, LONG);
});

describe('accès croisé entre espaces', () => {
  it('l’id d’une zone EN CACHE, demandé depuis un autre espace : ni le cache, ni la zone, rien d’écrit', async () => {
    await paver(zone, org);
    const avant = lignes(zone);
    expect(await enCache(zone, autreOrg)).toBeNull();
    expect((await paver(zone, autreOrg)).refus).toBe('zone_introuvable');
    expect(lignes(zone)).toBe(avant);
  }, LONG);
});

describe('péremption', () => {
  it('paver_cercles remplacée (autre définition) : la ligne n’est plus servie', async () => {
    await paver(zone, org);
    const sortie = psql(`begin;
      create or replace function public.paver_cercles_md5() returns text language sql stable as $f$ select 'autre' $f$;
      select (public.pavage_cercles_en_cache('${zone}', '${org}', 'ind', 1000, 20, 0, null) is null)::text;
      rollback;`);
    expect(sortie).toBe('true');
    expect((await enCache(zone, org))?.cache).toBe(true);
  }, LONG);

  it('la base est reconstruite (une bande plus récente) : la ligne n’est plus servie', async () => {
    await paver(zone, org);
    const sortie = psql(`begin;
      update public.carreau_couverture_e7_lots set construit_le = clock_timestamp() + interval '1 hour'
       where lot = (select min(lot) from public.carreau_couverture_e7_lots);
      select (public.pavage_cercles_en_cache('${zone}', '${org}', 'ind', 1000, 20, 0, null) is null)::text;
      rollback;`);
    expect(sortie).toBe('true');
  }, LONG);

  it('la base n’est plus certifiée complète : rien n’est servi, le pavage refuse', async () => {
    await paver(zone, org);
    const sortie = psql(`begin;
      delete from public.carreau_couverture_controle;
      select (public.pavage_cercles_en_cache('${zone}', '${org}', 'ind', 1000, 20, 0, null) is null)::text
          || '|' || (public.paver_cercles_cache('${zone}', '${org}', 'ind', 1000, 20, 0, null)->>'refus');
      rollback;`);
    expect(sortie).toBe('true|couverture_non_construite');
  }, LONG);

  it('la forme change : l’ancien pavage n’est plus servi, le suivant repave sous la nouvelle version', async () => {
    const avant = await paver(zone, org);
    const { error } = await admin.rpc('remplacer_geometrie_zone', { p_zone_id: zone, p_org_id: org, p_geometry_geojson: LYON_PLUS_PETIT });
    if (error) throw new Error(error.message);
    expect(await enCache(zone, org)).toBeNull();
    const apres = await paver(zone, org);
    expect(apres.cache).toBe(false);
    expect(apres.zone_maj).not.toBe(avant.zone_maj);
    expect((await enCache(zone, org))?.zone_maj).toBe(apres.zone_maj);
  }, LONG);

  it('la suppression de la zone emporte ses lignes (cascade)', async () => {
    expect(lignes(zone)).toBeGreaterThan(0);
    const { error } = await admin.from('custom_geo_zones').delete().eq('id', zone);
    if (error) throw new Error(error.message);
    expect(lignes(zone)).toBe(0);
  }, LONG);
});
