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
 * D37 (sql/340, décision de Vincent du 03/11, remplace les paliers du tour 1) : la forme envoyée est TOUJOURS simplifiée à
 * 50 m (`simplification_polygone_m`, relu), à l'extraction seulement — la zone enregistrée ne change pas —, puis ses
 * morceaux de moins de 0,04 km² (un carreau, `polygone_morceau_min_km2`) sont retirés et comptés dans la perte. La perte
 * est recalculée sur la bande (morceaux retirés compris), affichée au-delà de 0,1 % ; sommets et morceaux restent
 * contrôlés contre le registre (TTD « à vérifier »). Les deux cas nouveaux : une zone à trois îlots d'un carreau (retirés,
 * leur population perdue) et une zone faite de ces seuls îlots (refus `morceaux_tous_retires`).
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
// Tour 1 : sql/313 redéfinit forme_simplifiee, simplification_polygone et creer_extraction_jeu_zone — rejouée après 312.
// B12 : sql/317 porte la dernière définition de creer_extraction_jeu_zone ; B13 : sql/318 redéfinit
// `plateformes_geo_parametres_valides` (comportements des minimums) — rejouées après 313, dans cet ordre. B14 : sql/319
// porte la dernière définition de creer_extraction_jeu_zone (blocs), rejouée en dernier.
const MIGRATION = ['312_polygone_sommets_morceaux.sql', '313_polygone_paliers_tolerance.sql', '317_plan_par_plateforme.sql',
  '318_minimums_population.sql', '319_decoupage_blocs.sql',
  // C29 : sql/329 redéfinit `plateformes_geo_parametres_valides` (et les limites admises) — rejouée en dernier.
  '329_categorie_speciale.sql',
  // C24 round 1 : sql/330 redéfinit `paver_cercles` (après sql/318).
  '330_minimums_population_totale.sql',
  // D37 : sql/340 redéfinit la mesure, son enveloppe et creer_extraction_jeu_zone — rejouée en dernier.
  '340_polygone_simplifie_50m.sql']
  .map((f) => readFileSync(join(process.cwd(), 'sql', f), 'utf8')).join('\n');

let org = '';
const zones: Record<string, string> = {};

/** 2 000 points sur une grille 40 × 50 au pas de 2,5 km autour de Toulouse, disques géodésiques (règle de zone_rayon_poi, sql/254). */
const disques = (rayon: number, extra = '') => `(select ST_AsGeoJSON(ST_Union(g)) from (
   select ST_Buffer(ST_SetSRID(ST_MakePoint(1.1 + i * 0.031, 43.3 + j * 0.0225), 4326)::geography, ${rayon})::geometry g
     from generate_series(0, 39) i, generate_series(0, 49) j
   ${extra}) d)`;
/** Tour 1 (I-1 b) : un 2 001e disque, isolé au nord de la grille — 2 001 morceaux, un de plus que la borne TTD. */
const DISQUE_EN_PLUS = `union all select ST_Buffer(ST_SetSRID(ST_MakePoint(1.1, 44.5), 4326)::geography, 500)::geometry`;
/** Une étoile de 499 sommets distincts (rayons 10 et 9 km en alternance) : chaque sommet s'écarte de ≈ 1 km de ses voisins. */
const ETOILE = `(select ST_AsGeoJSON(ST_MakePolygon(ST_AddPoint(l, ST_StartPoint(l)))) from (
   select ST_MakeLine(array_agg(ST_Project(ST_SetSRID(ST_MakePoint(1.44, 43.6), 4326)::geography,
                                          case when k % 2 = 0 then 10000 else 9000 end, radians(k * 360.0 / 499))::geometry order by k)) l
     from generate_series(0, 498) k) s)`;

/**
 * D37 : trois carreaux peuplés du Gers (ordre stable), chacun couvert par un îlot de 80 m de rayon (≈ 0,02 km², sous le
 * morceau minimal d'un carreau) : le centroïde du carreau est dans l'îlot, ceux des voisins (à 200 m) n'y sont pas.
 */
const ILOTS = `select ST_Buffer(ST_Transform(c.centroide_3857, 4326)::geography, 80)::geometry g, c.pops[1] pop
   from public.carreau_couverture c where c.code_departement = '32' and c.pops[1] >= 20 order by c.carreau_id limit 3`;
/** Un disque de 2 km autour de Toulouse et les trois îlots. */
const DISQUE_ET_ILOTS = `(select ST_AsGeoJSON(ST_Union(g)) from (
   select ST_Buffer(ST_SetSRID(ST_MakePoint(1.44, 43.6), 4326)::geography, 2000)::geometry g
   union all select g from (${ILOTS}) i) d)`;
const ILOTS_SEULS = `(select ST_AsGeoJSON(ST_Union(g)) from (${ILOTS}) i)`;

function creerZone(nom: string, recette: string, geojson: string): string {
  const id = psql(`select public.creer_zone_recette('${nom}', '${org}', null, '${recette}', ${geojson})->>'id';`);
  if (!id) throw new Error(`zone ${nom} non créée`);
  return id;
}

/** La mesure telle que l'extraction la demande : bornes de TTD au polygone, lues par la base (tour 1, sql/313). */
const mesurer = (zone: string, cible = 'ind'): MesureSimplification & { carreaux_bande: number; sous_bornes: boolean } =>
  JSON.parse(psql(`select public.simplification_polygone_plateforme('${zone}', '${org}', '${cible}', 'ttd');`));
const sommetsA = (zone: string, tolerance: number) =>
  Number(psql(`select ST_NPoints(public.forme_simplifiee(geometry, ${tolerance})) from public.custom_geo_zones where id = '${zone}';`));
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
  zones.poi2001 = creerZone('POI 2 001 x 500 m (A7)', poi, disques(500, DISQUE_EN_PLUS));
  zones.ilots = creerZone('Disque et trois îlots (D37)', '{"v":1,"type":"import"}', DISQUE_ET_ILOTS);
  zones.ilotsSeuls = creerZone('Trois îlots seuls (D37)', '{"v":1,"type":"import"}', ILOTS_SEULS);
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
    ['un palier au pas du carreau', `update public.reglages_conversion set valeur = 200 where cle = 'simplification_polygone_palier_4'`],
    ['un morceau minimal nul (D37)', `update public.reglages_conversion set valeur = 0 where cle = 'polygone_morceau_min_km2'`],
    ['un morceau minimal d’un km² (D37)', `update public.reglages_conversion set valeur = 1 where cle = 'polygone_morceau_min_km2'`],
    ['un seuil d’affichage négatif', `update public.reglages_conversion set valeur = -1 where cle = 'perte_simplification_affichee'`],
    ['un paramètre « à vérifier » inconnu', `update public.plateformes_geo set parametres_a_verifier = '{polygone_max}' where plateforme = 'ttd' and maille = 'polygone'`],
  ])('la base refuse %s', (_cas, ordre) => {
    expect(() => psql(`begin;\n${ordre};\nrollback;`)).toThrow(/violates check constraint/);
  });

  it('D37 : tolérance 50 m relue, morceau minimal 0,04 km², paliers déclarés remplacés, perte affichée au-delà de 0,1 %', () => {
    expect(psql(`select valeur || '|' || (description like 'Extraction en maille polygone%') from public.reglages_conversion
                   where cle = 'simplification_polygone_m';`)).toBe('50|true');
    expect(psql(`select valeur from public.reglages_conversion where cle = 'polygone_morceau_min_km2';`)).toBe('0.04');
    expect(psql(`select count(*) filter (where description like 'REMPLACE%') || '/' || count(*) from public.reglages_conversion
                   where cle like 'simplification\_polygone\_palier\_%';`)).toBe('4/4');
    expect(psql(`select valeur from public.reglages_conversion where cle = 'perte_simplification_affichee';`)).toBe('0.1');
  });

  it('tour 1 (I-1) : la note TTD dit que les deux bornes sont des valeurs de test, sans source', () => {
    expect(psql(`select note from public.plateformes_geo where plateforme = 'ttd' and maille = 'polygone';`))
      .toContain('(20 000 sommets, 2 000 morceaux) : valeurs de test, sans source, a relever par dentsu (Q29)');
  });

  it('la migration rejouée deux fois : empreinte identique, et identique à la base', () => {
    const empreinte = `select md5(
      (select string_agg(t::text, ';' order by plateforme, maille) from public.plateformes_geo t)
      || (select string_agg(t::text, ';' order by cle) from public.reglages_conversion t)
      || (select string_agg(pg_get_functiondef(p.oid), ';' order by p.proname) from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('forme_simplifiee', 'forme_extraction_polygone', 'simplification_polygone', 'simplification_polygone_plateforme',
                               'creer_extraction_jeu_zone', 'plateformes_geo_parametres_valides')));`;
    const base = psql(empreinte);
    const lignes = psqlLignes(`begin;\n${MIGRATION}\n${empreinte}\n${MIGRATION}\n${empreinte}\nrollback;`);
    const [premiere, seconde] = lignes.slice(-2);
    expect(premiere).toBe(seconde);
    expect(seconde).toBe(base);
  }, LONG);
});

describe('simplification_polygone — la forme envoyée, ses bornes, sa perte', () => {
  it('D37 : zone POI à 2 000 disques de 500 m : 66 000 → 18 000 sommets à 50 m, aucun morceau retiré, perte affichée', () => {
    const m = mesurer(zones.poi500);
    expect(m).toMatchObject({
      tolerance_m: 50, morceau_min_km2: 0.04, simplifiee: true, sous_bornes: true,
      sommets_avant: 66_000, morceaux_avant: 2_000, sommets: 18_000, morceaux: 2_000, morceaux_retires: 0,
    });
    expect(sommetsA(zones.poi500, 50)).toBe(m.sommets);
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

  it('la même à 1 km : 34 000 sommets à 50 m → refusée, chiffrée (obtenu, admis, à vérifier)', () => {
    const m = mesurer(zones.poi1000);
    expect(m).toMatchObject({ sommets_avant: 66_000, morceaux: 2_000, sous_bornes: false, tolerance_m: 50, perdue: 0, carreaux_bande: 0 });
    expect(depassementsPolygone(m, ligneTtd())).toEqual([
      { code: 'polygone_sommets_max', limite: 20_000, valeur: m.sommets, a_verifier: true },
    ]);
    expect(m.sommets).toBeGreaterThan(20_000);
  }, LONG);

  it('tour 1 (I-1 b) : 2 001 disques → 2 001 morceaux, refus « morceaux » chiffré sur la vraie base (aucun disque sous 0,04 km² : rien de retiré)', () => {
    const m = mesurer(zones.poi2001);
    expect(m).toMatchObject({ morceaux_avant: 2_001, morceaux: 2_001, sous_bornes: false, tolerance_m: 50, morceaux_max: 2_000 });
    expect(depassementsPolygone(m, ligneTtd())).toContainEqual(
      { code: 'polygone_morceaux_max', limite: 2_000, valeur: 2_001, a_verifier: true });
  }, LONG);

  it('D37 : une forme déjà sous les bornes est simplifiée elle aussi — CIRFA Bretagne (2 792 sommets) à 50 m, perte sous 0,1 %', () => {
    const cirfa = JSON.parse(psql(`select public.simplification_polygone_plateforme(id, org_id, 'ind', 'ttd') from public.custom_geo_zones
                                    where id = 'f001b479-b870-4958-978d-e7a98b90de57';`));
    expect(cirfa).toMatchObject({ tolerance_m: 50, simplifiee: true, sous_bornes: true, sommets_avant: 2_792, morceaux_avant: 5, morceaux: 5, morceaux_retires: 0 });
    expect(cirfa.sommets).toBeLessThan(2_792);
    const pop = Number(psql(`select public.couverture_geometrie(id, org_id, 'ind', 'forme')->>'population' from public.custom_geo_zones
                               where id = 'f001b479-b870-4958-978d-e7a98b90de57';`));
    expect(avertissementSimplification(cirfa, pop)).toEqual([]);
    // La zone enregistrée ne change pas : la simplification est à l'extraction seulement.
    expect(psql(`select ST_NPoints(geometry) from public.custom_geo_zones where id = 'f001b479-b870-4958-978d-e7a98b90de57';`)).toBe('2792');
  });

  it('D37 : les îlots de moins de 0,04 km² sont retirés et leur population comptée dans la perte, affichée', () => {
    const m = mesurer(zones.ilots);
    expect(m).toMatchObject({ tolerance_m: 50, simplifiee: true, sous_bornes: true, morceaux_avant: 4, morceaux: 1, morceaux_retires: 3 });
    const popIlots = Number(psql(`select sum(pop) from (${ILOTS}) i;`));
    expect(popIlots).toBeGreaterThan(0);
    expect(m.perdue).toBeGreaterThanOrEqual(Math.round(popIlots));
    const [avertissement] = avertissementSimplification(m, population(zones.ilots));
    expect(avertissement).toMatchObject({ code: 'perte_simplification', n: m.perdue });
    // La forme figée par l'extraction est la même : un seul morceau, les sommets mesurés.
    expect(psql(`select ST_NumGeometries(f) || '|' || ST_NPoints(f) from (select public.forme_extraction_polygone(geometry, 50, 0.04) f
                   from public.custom_geo_zones where id = '${zones.ilots}') x;`)).toBe(`1|${m.sommets}`);
    // La zone enregistrée garde ses quatre morceaux.
    expect(psql(`select ST_NumGeometries(geometry) from public.custom_geo_zones where id = '${zones.ilots}';`)).toBe('4');
  }, LONG);

  it('D37 : une zone faite des seuls îlots — tout serait retiré → refus morceaux_tous_retires, chiffré', () => {
    expect(JSON.parse(psql(`select public.simplification_polygone_plateforme('${zones.ilotsSeuls}', '${org}', 'ind', 'ttd');`)))
      .toEqual({ refus: 'morceaux_tous_retires', morceaux_avant: 3, morceau_min_km2: 0.04 });
    expect(psql(`select public.forme_extraction_polygone(geometry, 50, 0.04) is null from public.custom_geo_zones where id = '${zones.ilotsSeuls}';`)).toBe('t');
  }, LONG);

  it('zone importée à 500 sommets, tous significatifs : inchangée à l’octet, aucun carreau lu, aucune perte', () => {
    const m = mesurer(zones.etoile);
    expect(m).toMatchObject({ tolerance_m: 50, simplifiee: false, morceaux_retires: 0, sommets_avant: 500, sommets: 500, morceaux: 1, carreaux_bande: 0, perdue: 0, gagnee: 0 });
    expect(psql(`select ST_AsEWKB(public.forme_extraction_polygone(geometry, 50, 0.04)) = ST_AsEWKB(geometry) from public.custom_geo_zones
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
    expect(JSON.parse(psql(`select public.simplification_polygone_plateforme('${zones.poi500}', gen_random_uuid(), 'ind', 'ttd');`))).toEqual({ refus: 'zone_introuvable' });
    expect(JSON.parse(psql(`select public.simplification_polygone_plateforme('${zones.poi500}', '${org}', 'xxx', 'ttd');`))).toEqual({ refus: 'cible_inconnue' });
    // Une plateforme sans ligne polygone (TikTok n'en a pas) : regle_introuvable.
    expect(JSON.parse(psql(`select public.simplification_polygone_plateforme('${zones.poi500}', '${org}', 'ind', 'tiktok');`))).toEqual({ refus: 'regle_introuvable' });
    // L'ancienne mesure (enveloppe, sans plateforme) : aucune borne, mais la même forme envoyée (D37, 50 m toujours).
    expect(JSON.parse(psql(`select public.simplification_polygone('${zones.poi500}', '${org}', 'ind');`)))
      .toMatchObject({ tolerance_m: 50, simplifiee: true, sous_bornes: true, sommets: 18_000, sommets_max: null });
  });

  it('EXPLAIN ANALYZE : la bande de la zone POI se lit par l’index des centroïdes, sans parcours séquentiel', () => {
    const plan = psqlLignes(`create temp table b as select ST_SymDifference(geometry, public.forme_simplifiee(geometry, 50)) g
                               from public.custom_geo_zones where id = '${zones.poi500}';
      explain (analyze, buffers, costs off) select count(*) from b, lateral public.carreaux_de_forme_menages(b.g, 1, 17) f;`).join('\n');
    expect(plan).toMatch(/Index Scan using idx_carreau_couverture_centroide/);
    expect(plan).not.toMatch(/Seq Scan on carreau_couverture/);
  }, LONG);
});
