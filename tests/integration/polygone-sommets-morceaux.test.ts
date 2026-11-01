/**
 * A7 (sql/312) — à l'extraction en maille POLYGONE, la forme est simplifiée (Douglas-Peucker, tolérance 50 m lue dans
 * `reglages_conversion`), puis ses sommets et morceaux sont contrôlés contre `plateformes_geo.polygone_sommets_max` /
 * `polygone_morceaux_max` ; la population perdue par la simplification est chiffrée sur la seule bande qui change.
 *
 * Ce que ce fichier prouve, contre la base locale :
 *   - la migration : colonnes, seed TTD « à vérifier » par paramètre, CHECK (ligne polygone seulement, > 0), réglages
 *     bornés ; rejouée deux fois à empreinte identique (transaction annulée) ;
 *   - une zone POI à 2 000 disques de 500 m (66 000 sommets, 2 000 morceaux, au-dessus de la borne d'import) :
 *     simplifiée SOUS la borne TTD, perte > 0,1 % de la population de la zone → l'avertissement est produit ;
 *   - la même à 2 000 disques de 1 km : 34 000 sommets après simplification → refusée par la borne TTD (20 000) ;
 *   - une zone importée de 500 sommets, tous significatifs : INCHANGÉE (à l'octet), aucun carreau lu, perte nulle ;
 *   - `EXPLAIN ANALYZE` de la lecture de la bande sur la plus lourde zone locale, s'il y en a une.
 *
 * L'espace de test (et ses zones) est supprimé en cascade en fin de fichier.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { avertissementSimplification, depassementsPolygone, type MesureSimplification } from '@/lib/zones/polygone-extraction';
import { PlateformeGeoSchema } from '@/lib/zones/plateformes';
import { creerClientTest } from './_client';
import { psql, psqlLignes } from './_psql';

const admin = creerClientTest();
const LONG = 180_000;
const MIGRATION = readFileSync(join(process.cwd(), 'sql', '312_polygone_sommets_morceaux.sql'), 'utf8');

let org = '';
const zones: Record<string, string> = {};

/** 2 000 points sur une grille 40 × 50 au pas de 2,5 km autour de Toulouse, disques géodésiques (règle de zone_rayon_poi, sql/254). */
const disques = (rayon: number) => `(select ST_AsGeoJSON(ST_Union(ST_Buffer(ST_SetSRID(ST_MakePoint(1.1 + i * 0.031, 43.3 + j * 0.0225), 4326)::geography, ${rayon})::geometry))
   from generate_series(0, 39) i, generate_series(0, 49) j)`;
/** Une étoile de 499 sommets distincts (rayons 10 et 9 km en alternance) : chaque sommet s'écarte de ≈ 1 km de ses voisins. */
const ETOILE = `(select ST_AsGeoJSON(ST_MakePolygon(ST_AddPoint(l, ST_StartPoint(l)))) from (
   select ST_MakeLine(array_agg(ST_Project(ST_SetSRID(ST_MakePoint(1.44, 43.6), 4326)::geography,
                                          case when k % 2 = 0 then 10000 else 9000 end, radians(k * 360.0 / 499))::geometry order by k)) l
     from generate_series(0, 498) k) s)`;

function creerZone(nom: string, recette: string, geojson: string): string {
  const id = psql(`select public.creer_zone_recette('${nom}', '${org}', null, '${recette}', ${geojson})->>'id';`);
  if (!id) throw new Error(`zone ${nom} non créée`);
  return id;
}

const mesurer = (zone: string, cible = 'ind'): MesureSimplification & { carreaux_bande: number } =>
  JSON.parse(psql(`select public.simplification_polygone('${zone}', '${org}', '${cible}');`));
const population = (zone: string): number =>
  Number(psql(`select public.couverture_geometrie('${zone}', '${org}', 'ind', 'forme')->>'population';`));
/** La ligne TTD au polygone telle que la route la lit (schéma Zod compris). */
const ligneTtd = () => PlateformeGeoSchema.parse(JSON.parse(psql(`select row_to_json(t) from (select plateforme, maille, libelle, natif,
  disponible, limites, doc_url, releve_le::text, a_verifier, note, ordre, codes_pays, pays_a_verifier, poids_groupe_cp,
  parametres_a_verifier, polygone_sommets_max, polygone_morceaux_max from public.plateformes_geo
  where plateforme = 'ttd' and maille = 'polygone') t;`)));

beforeAll(async () => {
  const { data, error } = await admin.from('organizations')
    .insert({ name: '[ESSAI A7] sommets du polygone', slug: `essai-a7-${Date.now()}` }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  org = data.id as string;
  const poi = '{"v":1,"type":"rayon_poi","categorie":"lycee","rayon_m":500,"perimetre":{"type":"departement","code":"31"}}';
  zones.poi500 = creerZone('POI 2 000 x 500 m (A7)', poi, disques(500));
  zones.poi1000 = creerZone('POI 2 000 x 1 km (A7)', poi.replace('500', '1000'), disques(1000));
  zones.etoile = creerZone('Import 500 sommets (A7)', '{"v":1,"type":"import"}', ETOILE);
}, LONG);

afterAll(async () => {
  if (!org) return;
  const { error } = await admin.from('organizations').delete().eq('id', org);
  if (error) throw new Error(`nettoyage : ${error.message}`);
});

describe('sql/312 — le registre et les réglages', () => {
  it('TTD au polygone : 20 000 sommets et 2 000 morceaux, chacun « à vérifier » ; aucune autre ligne n’a de borne', () => {
    expect(psql(`select polygone_sommets_max || '|' || polygone_morceaux_max || '|' || array_to_string(parametres_a_verifier, ',')
                   from public.plateformes_geo where plateforme = 'ttd' and maille = 'polygone';`))
      .toBe('20000|2000|polygone_morceaux_max,polygone_sommets_max');
    expect(psql(`select count(*) from public.plateformes_geo where (polygone_sommets_max is not null or polygone_morceaux_max is not null)
                   and not (plateforme = 'ttd' and maille = 'polygone');`)).toBe('0');
    expect(ligneTtd()).toMatchObject({ polygone_sommets_max: 20_000, polygone_morceaux_max: 2_000 });
  });

  it.each([
    ['une borne sur une ligne CP', `update public.plateformes_geo set polygone_sommets_max = 10 where plateforme = 'ttd' and maille = 'cp'`],
    ['une borne nulle', `update public.plateformes_geo set polygone_morceaux_max = 0 where plateforme = 'ttd' and maille = 'polygone'`],
    ['une tolérance au pas du carreau', `update public.reglages_conversion set valeur = 200 where cle = 'simplification_polygone_m'`],
    ['un seuil d’affichage négatif', `update public.reglages_conversion set valeur = -1 where cle = 'perte_simplification_affichee'`],
    ['un paramètre « à vérifier » inconnu', `update public.plateformes_geo set parametres_a_verifier = '{polygone_max}' where plateforme = 'ttd' and maille = 'polygone'`],
  ])('la base refuse %s', (_cas, ordre) => {
    expect(() => psql(`begin;\n${ordre};\nrollback;`)).toThrow(/violates check constraint/);
  });

  it('les réglages : tolérance 50 m, perte affichée au-delà de 0,1 %', () => {
    expect(psql(`select string_agg(cle || '=' || valeur, ',' order by cle) from public.reglages_conversion
                   where cle in ('simplification_polygone_m', 'perte_simplification_affichee');`))
      .toBe('perte_simplification_affichee=0.1,simplification_polygone_m=50');
  });

  it('la migration rejouée deux fois : empreinte identique, et identique à la base', () => {
    const empreinte = `select md5(
      (select string_agg(t::text, ';' order by plateforme, maille) from public.plateformes_geo t)
      || (select string_agg(t::text, ';' order by cle) from public.reglages_conversion t)
      || (select string_agg(pg_get_functiondef(p.oid), ';' order by p.proname) from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('forme_simplifiee', 'simplification_polygone', 'creer_extraction_jeu_zone', 'plateformes_geo_parametres_valides')));`;
    const base = psql(empreinte);
    const lignes = psqlLignes(`begin;\n${MIGRATION}\n${empreinte}\n${MIGRATION}\n${empreinte}\nrollback;`);
    const [premiere, seconde] = lignes.slice(-2);
    expect(premiere).toBe(seconde);
    expect(seconde).toBe(base);
  }, LONG);
});

describe('simplification_polygone — la forme envoyée, ses bornes, sa perte', () => {
  it('zone POI à 2 000 disques de 500 m : 66 000 sommets → sous la borne TTD, perte affichée (> 0,1 %)', () => {
    const m = mesurer(zones.poi500);
    expect(m).toMatchObject({ tolerance_m: 50, simplifiee: true, sommets_avant: 66_000, morceaux_avant: 2_000, morceaux: 2_000 });
    expect(m.sommets).toBeLessThanOrEqual(20_000);
    expect(depassementsPolygone(m, ligneTtd())).toEqual([]);
    // Un disque de 500 m simplifié à 50 m près est un polygone inscrit : la perte est réelle et se dit.
    const pop = population(zones.poi500);
    expect(m.perdue).toBeGreaterThan(0);
    const [avertissement] = avertissementSimplification(m, pop);
    expect(avertissement).toMatchObject({ code: 'perte_simplification', limite: 0.1, n: m.perdue });
    expect(avertissement.valeur).toBeGreaterThan(0.1);
    // Seuls les carreaux de la bande sont lus.
    expect(m.carreaux_bande).toBeGreaterThan(0);
    expect(m.carreaux_bande).toBeLessThan(Number(psql(`select public.couverture_geometrie('${zones.poi500}', '${org}', 'ind', 'forme')->>'n_carreaux';`)));
  }, LONG);

  it('la même à 1 km : 34 000 sommets après simplification → refusée, chiffrée (obtenu, admis, à vérifier)', () => {
    const m = mesurer(zones.poi1000);
    expect(m).toMatchObject({ sommets_avant: 66_000, morceaux: 2_000 });
    expect(depassementsPolygone(m, ligneTtd())).toEqual([
      { code: 'polygone_sommets_max', limite: 20_000, valeur: m.sommets, a_verifier: true },
    ]);
    expect(m.sommets).toBeGreaterThan(20_000);
  }, LONG);

  it('zone importée à 500 sommets, tous significatifs : inchangée à l’octet, aucun carreau lu, aucune perte', () => {
    const m = mesurer(zones.etoile);
    expect(m).toMatchObject({ simplifiee: false, sommets_avant: 500, sommets: 500, morceaux: 1, carreaux_bande: 0, perdue: 0, gagnee: 0 });
    expect(psql(`select ST_AsEWKB(public.forme_simplifiee(geometry, 50)) = ST_AsEWKB(geometry) from public.custom_geo_zones
                   where id = '${zones.etoile}';`)).toBe('t');
    expect(avertissementSimplification(m, population(zones.etoile))).toEqual([]);
  }, LONG);

  it('minimum de ménages (A5) : la perte d’une cible ménages ne compte que les carreaux retenus, jamais plus que la population totale', () => {
    const ind = mesurer(zones.poi500);
    const pauvres = mesurer(zones.poi500, 'men_pauv');
    expect(pauvres.sommets).toBe(ind.sommets);
    expect(pauvres.carreaux_bande).toBeLessThanOrEqual(ind.carreaux_bande);
    expect(pauvres).toMatchObject({ min_menages: 11 });
  }, LONG);

  it('une zone d’un autre espace : zone_introuvable ; une cible inconnue : cible_inconnue', () => {
    expect(JSON.parse(psql(`select public.simplification_polygone('${zones.poi500}', gen_random_uuid(), 'ind');`))).toEqual({ refus: 'zone_introuvable' });
    expect(JSON.parse(psql(`select public.simplification_polygone('${zones.poi500}', '${org}', 'xxx');`))).toEqual({ refus: 'cible_inconnue' });
  });

  it('EXPLAIN ANALYZE : la bande de la zone POI se lit par l’index des centroïdes, sans parcours séquentiel', () => {
    const plan = psqlLignes(`create temp table b as select ST_SymDifference(geometry, public.forme_simplifiee(geometry, 50)) g
                               from public.custom_geo_zones where id = '${zones.poi500}';
      explain (analyze, buffers, costs off) select count(*) from b, lateral public.carreaux_de_forme_menages(b.g, 1, 17) f;`).join('\n');
    expect(plan).toMatch(/Index Scan using idx_carreau_couverture_centroide/);
    expect(plan).not.toMatch(/Seq Scan on carreau_couverture/);
  }, LONG);
});
