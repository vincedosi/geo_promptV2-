/**
 * Des périmètres sans interstices (lot 4, T2, arbitrage A-5) — `geom_perimetre` sur `ref_departements` et
 * `ref_regions`, lue par `resoudre_perimetre`.
 *
 * Mesuré le 22/10 : les contours de département et de région sont des unions de communes simplifiées, percées de
 * 45 834 trous intérieurs (1 976 km²). Dans les Bouches-du-Rhône, 678 trous (21,7 km²) avalaient 356 carreaux et
 * 78 834 habitants — 4,3 % du département, dont le centre d'Aix (« 13100 couvert à 92,5 % »). Les vraies enclaves,
 * elles, doivent RESTER : l'enclave des Papes (26), les enclaves des Hautes-Pyrénées (64), les communes du Nord dans le
 * Pas-de-Calais (62), Llívia (66) et cinq petites (02, 53, 55, 61, 71), relevées une à une dans le rapport de T2.
 *
 * Les requêtes passent par psql dans le conteneur (comme purge-panneaux-brest.test.ts) : ce sont des lectures directes
 * de géométries, qu'aucune RPC n'expose. La population n'est PAS lue par `zone_seuil_carreaux` : le département compte
 * 32 462 carreaux, au-delà de son plafond de 20 000 (correction R-7 de la relecture du plan).
 */
import { describe, expect, it } from 'vitest';
import { sql } from './_psql';


/** Aires (km², géodésiques) des trous de la géométrie, du plus grand au plus petit. */
function trous(table: 'ref_departements' | 'ref_regions', cle: string, code: string, colonne: string): number[] {
  const [l] = sql(`
    select coalesce(string_agg(round((ST_Area(ST_MakePolygon(ST_InteriorRingN(d.geom, i))::geography) / 1e6)::numeric, 1)::text,
                               ';' order by ST_Area(ST_MakePolygon(ST_InteriorRingN(d.geom, i))::geography) desc), '')
      from public.${table} t, ST_Dump(ST_CollectionExtract(t.${colonne}, 3)) d,
           generate_series(1, ST_NumInteriorRings(d.geom)) i
     where t.${cle} = '${code}';`);
  return l === '' ? [] : l.split(';').map(Number);
}

describe('sql/265 — périmètres sans interstices', () => {
  it('chaque département et chaque région a un geom_perimetre MultiPolygon valide, en 4326', () => {
    for (const table of ['ref_departements', 'ref_regions']) {
      const [n, mauvais] = sql(`
        select count(*), count(*) filter (where geom_perimetre is null or not ST_IsValid(geom_perimetre)
                                             or GeometryType(geom_perimetre) <> 'MULTIPOLYGON' or ST_SRID(geom_perimetre) <> 4326)
          from public.${table} where geom is not null;`);
      expect(Number(n), table).toBeGreaterThan(0);
      expect(Number(mauvais), table).toBe(0);
    }
  });

  it('le périmètre bouché CONTIENT l’ancien, sur tous les départements et toutes les régions (rien n’est rogné)', () => {
    for (const table of ['ref_departements', 'ref_regions']) {
      const [rognes] = sql(`select count(*) from public.${table}
                             where geom is not null and not ST_Covers(geom_perimetre, ST_CollectionExtract(geom, 3));`);
      expect(Number(rognes), table).toBe(0);
    }
  });

  it('boucher_interstices, appelée directement : la règle sur trois trous fabriqués', () => {
    const anneaux = (carre: string, trou: string, code: string) => sql(`
      select sum(ST_NumInteriorRings(d.geom)) from ST_Dump(public.boucher_interstices(
        ST_GeomFromText('POLYGON((${carre}),(${trou}))', 4326), '${code}', 'departement')) d;`)[0];
    // Dans Aix, 0,2 km² couverts par des communes du 13 : une fente, bouchée.
    expect(anneaux('5.40 43.50,5.50 43.50,5.50 43.56,5.40 43.56,5.40 43.50', '5.44 43.52,5.445 43.52,5.445 43.525,5.44 43.525,5.44 43.52', '13')).toBe('0');
    // Sur Pertuis, couverte par une commune du 84 : une enclave d'une autre unité, gardée.
    expect(anneaux('5.40 43.60,5.60 43.60,5.60 43.80,5.40 43.80,5.40 43.60', '5.49 43.68,5.51 43.68,5.51 43.70,5.49 43.70,5.49 43.68', '13')).toBe('1');
    // En mer, 22,8 km² sans commune française : gardé (règle de Llívia, > 5 km²).
    expect(anneaux('4 42.5,4.2 42.5,4.2 42.7,4 42.7,4 42.5', '4.05 42.55,4.1 42.55,4.1 42.6,4.05 42.6,4.05 42.55', '13')).toBe('1');
  });

  it('Bouches-du-Rhône : plus aucun trou, et 20,7 km² de plus', () => {
    // 678 trous pour 21,7 km² ; mais 10 petits polygones du département (1,0 km²) étaient DÉJÀ posés dans ces trous :
    // la surface gagnée est 21,7 − 1,0 = 20,68 km² (mesuré le 22/10), pas 21,7 comme le disait le plan.
    expect(trous('ref_departements', 'code_dept', '13', 'geom')).toHaveLength(678);
    expect(trous('ref_departements', 'code_dept', '13', 'geom_perimetre')).toEqual([]);
    const [gain] = sql(`
      select (ST_Area(geom_perimetre::geography) - ST_Area(ST_CollectionExtract(geom, 3)::geography)) / 1e6
        from public.ref_departements where code_dept = '13';`);
    expect(Number(gain)).toBeGreaterThan(20.58);
    expect(Number(gain)).toBeLessThan(20.78);
  });

  it.each([
    ['26', 'enclave des Papes (Vaucluse)', 129.8],
    ['64', 'enclaves des Hautes-Pyrénées', 41.5],
    ['62', 'communes du Nord', 23.5],
    ['66', 'Llívia (Espagne)', 11.4],
  ])('département %s : garde %s, et seulement elle', (code, _nom, km2) => {
    const t = trous('ref_departements', 'code_dept', code, 'geom_perimetre');
    expect(t).toHaveLength(1);
    expect(Math.abs(t[0] - km2)).toBeLessThanOrEqual(1);
  });

  it('les SEULS départements qui gardent des trous sont ceux des enclaves relevées (R3 : rien ne déborde)', () => {
    const [l] = sql(`
      select string_agg(code_dept, ',' order by code_dept) from public.ref_departements t
       where exists (select 1 from ST_Dump(ST_CollectionExtract(t.geom_perimetre, 3)) d where ST_NumInteriorRings(d.geom) > 0);`);
    expect(l.split(',')).toEqual(['02', '26', '53', '55', '61', '62', '64', '66', '71']);
  });

  it('Auvergne-Rhône-Alpes : garde l\'enclave des Papes (région Provence-Alpes-Côte d\'Azur), bouche le reste', () => {
    const [avant] = sql(`
      select sum(ST_NumInteriorRings(d.geom)) from public.ref_regions t, ST_Dump(ST_CollectionExtract(t.geom, 3)) d
       where t.code_region = '84';`);
    expect(Number(avant)).toBeGreaterThan(1000);
    // 133,1 km² et non 129,8 : le contour de la RÉGION est une autre simplification que celui du département 26.
    const t = trous('ref_regions', 'code_region', '84', 'geom_perimetre');
    expect(t).toHaveLength(1);
    expect(Math.abs(t[0] - 133.1)).toBeLessThanOrEqual(1);
  });

  it('Hauts-de-France : les communes du Nord dans le Pas-de-Calais sont de la MÊME région — bouchées', () => {
    expect(trous('ref_regions', 'code_region', '32', 'geom_perimetre')).toEqual([]);
  });

  it('les SEULES régions qui gardent un trou : 75 (Hautes-Pyrénées), 76 (Llívia), 84 (enclave des Papes)', () => {
    const [l] = sql(`
      select string_agg(code_region || ':' || n, ',' order by code_region) from (
        select t.code_region, sum(ST_NumInteriorRings(d.geom)) n
          from public.ref_regions t, ST_Dump(ST_CollectionExtract(t.geom_perimetre, 3)) d
         group by t.code_region having sum(ST_NumInteriorRings(d.geom)) > 0) x;`);
    expect(l).toBe('75:1,76:1,84:1');
  });

  it('resoudre_perimetre : département et région lus sur geom_perimetre, commune inchangée', () => {
    const [dep, reg, commune] = sql(`
      select (select md5(ST_AsBinary(r.g)) = (select md5(ST_AsBinary(geom_perimetre)) from public.ref_departements where code_dept = '13')
                from public.resoudre_perimetre('departement', '13', null, 100000, array['departement']) r),
             (select md5(ST_AsBinary(r.g)) = (select md5(ST_AsBinary(geom_perimetre)) from public.ref_regions where code_region = '84')
                from public.resoudre_perimetre('region', '84', null, 100000, array['region']) r),
             (select md5(ST_AsBinary(r.g)) = (select md5(ST_AsBinary(ST_Multi(geom))) from public.ref_communes where code_commune = '13001')
                from public.resoudre_perimetre('commune', '13001', null, 100000, array['commune']) r);`);
    expect([dep, reg, commune]).toEqual(['t', 't', 't']);
  });

  it('resoudre_perimetre : les refus sont inchangés (France, type non admis, code inconnu, trop grand)', () => {
    const refus = sql(`
      select (select refus from public.resoudre_perimetre('france', 'FR', null, 100000, array['region'])),
             (select refus from public.resoudre_perimetre('region', '84', null, 100000, array['departement'])),
             (select refus from public.resoudre_perimetre('departement', '00', null, 100000, array['departement'])),
             (select refus from public.resoudre_perimetre('region', '84', null, 12000, array['region']));`);
    expect(refus).toEqual(['perimetre_national_refuse', 'perimetre_non_admis', 'perimetre_inconnu', 'perimetre_trop_grand']);
  });

  it('population des carreaux dont le centroïde est dans le périmètre 13 : 1 827 580 avant, ≈ 1 906 414 après', () => {
    // La règle de sql/255:103-105 : sous-découpage 256, centroïde de geom_3857 dans un morceau, dédoublonné par carreau.
    const population = (geomSql: string) => {
      const [n, pop] = sql(`
        with m as materialized (select ST_Subdivide(ST_Transform(${geomSql}, 3857), 256) g from public.ref_departements where code_dept = '13')
        select count(*), round(sum(pop)) from (
          select distinct on (cf.id) cf.id, (cf.metadata->>'ind')::numeric pop
            from public.carreaux_filosofi cf join m on cf.geom_3857 && m.g and ST_Intersects(ST_Centroid(cf.geom_3857), m.g)) d;`);
      return { carreaux: Number(n), population: Number(pop) };
    };
    const avant = population('ST_Multi(geom)');
    const apres = population('geom_perimetre');
    expect(avant).toEqual({ carreaux: 32462, population: 1827580 });
    expect(Math.abs(apres.population - 1906414)).toBeLessThanOrEqual(50);
    expect(apres.carreaux - avant.carreaux).toBeGreaterThanOrEqual(350);
  });
});
