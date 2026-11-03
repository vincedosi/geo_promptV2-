/**
 * C25 (amendement E7, sql/332) — cohérence hiérarchique de la table carreau → CP / IRIS / commune / département.
 *
 * `carreau_couverture` (sql/266) rattache l'IRIS et le CP par le centre du carreau, mais la commune par le PREMIER code
 * de `lcog_geo` (ordre non garanti) : 54 300 carreaux (2,3 %) portaient une commune qui n'est pas celle de leur IRIS, et
 * 2 615 un département faux. 3 926 carreaux (71 788 hab.) n'avaient aucun CP : ils manquaient à la population nationale
 * au CP (écart département / CP de 63 684 en métropole, 8 104 outre-mer).
 *
 * La base locale est PARTAGÉE : la table brute ne change pas (`carreau-couverture.test.ts` la décrit et reste vrai).
 * La correction est portée par trois colonnes `_e7`, remplies pour les seuls carreaux qui changent, lues par la vue
 * `carreau_couverture_e7` (`coalesce(x_e7, x)`) et par des dénominateurs jumeaux `_e7`. À fusionner au merge.
 */
import { describe, expect, it } from 'vitest';
import { sql } from './_psql';

const LONG = 180_000;
const DEP = (col: string) => `case when left(${col}, 2) in ('97', '98') then left(${col}, 3) else left(${col}, 2) end`;

describe('sql/332 — carreau_couverture_e7 (C25, E7)', () => {
  it('invariant E7 sur les 2 324 577 carreaux : commune = IRIS[0:5], département = f(commune), aucun carreau sans CP', () => {
    const [n, communeFausse, depFaux, sansCp, sansCommune] = sql(`
      select count(*),
             count(*) filter (where code_iris is not null and code_commune is distinct from left(code_iris, 5)),
             count(*) filter (where code_departement is distinct from ${DEP('code_commune')}),
             count(*) filter (where code_postal is null),
             count(*) filter (where code_commune is null)
        from public.carreau_couverture_e7;`);
    expect(Number(n)).toBe(2_324_577);
    expect(Number(communeFausse)).toBe(0);
    expect(Number(depFaux)).toBe(0);
    expect(Number(sansCp)).toBe(0);
    expect(Number(sansCommune)).toBe(0);
  }, LONG);

  it('rapport des écarts : corrections posées sur les seuls carreaux qui changent, distance au CP gardée en contrôle', () => {
    const [nCommune, nDep, nCp, distMax, cpSansDistance, inutiles, brutsFaux] = sql(`
      select count(*) filter (where code_commune_e7 is not null),
             count(*) filter (where code_departement_e7 is not null),
             count(*) filter (where code_postal_e7 is not null),
             coalesce(max(distance_cp_e7_m), 0),
             count(*) filter (where code_postal_e7 is not null and distance_cp_e7_m is null),
             count(*) filter (where code_commune_e7 = code_commune or code_departement_e7 = code_departement
                                 or (code_postal_e7 is not null and code_postal is not null)),
             count(*) filter (where code_iris is not null and code_commune <> left(code_iris, 5))
        from public.carreau_couverture;`);
    // Mesuré le 03/11 avant correction : 54 300 communes, 2 615 départements, 3 926 CP. Écart attendu « en bordure ».
    expect(Number(nCommune)).toBeGreaterThan(40_000);
    expect(Number(nCommune)).toBeLessThan(0.05 * 2_324_577);
    expect(Number(nDep)).toBeGreaterThan(1_000);
    expect(Number(nCp)).toBe(Number(sql('select count(*) from public.carreau_couverture where code_postal is null;')[0]));
    expect(Number(distMax)).toBeLessThan(5_000);
    expect(Number(cpSansDistance)).toBe(0);
    expect(Number(inutiles)).toBe(0);
    // La table BRUTE n'a pas changé : c'est ce que les autres branches lisent.
    expect(Number(brutsFaux)).toBeGreaterThan(40_000);
  }, LONG);

  it('population nationale : somme par CP = somme par département, métropole et outre-mer, à l’arrondi près', () => {
    const [cpMetro, depMetro, cpDrom, depDrom, nCarrCp, nCarrDep] = sql(`
      select (select sum((populations->>'ind')::numeric) from public.cp_population_totale_e7 where left(code_postal, 2) not in ('97', '98')),
             (select sum((populations->>'ind')::numeric) from public.unite_population_totale_e7
               where maille = 'departement' and left(code, 2) not in ('97', '98')),
             (select sum((populations->>'ind')::numeric) from public.cp_population_totale_e7 where left(code_postal, 2) in ('97', '98')),
             (select sum((populations->>'ind')::numeric) from public.unite_population_totale_e7
               where maille = 'departement' and left(code, 2) in ('97', '98')),
             (select sum(n_carreaux) from public.cp_population_totale_e7),
             (select sum(n_carreaux) from public.unite_population_totale_e7 where maille = 'departement');`);
    expect(Math.abs(Number(cpMetro) - Number(depMetro))).toBeLessThan(1);
    expect(Math.abs(Number(cpDrom) - Number(depDrom))).toBeLessThan(1);
    expect(Number(nCarrCp)).toBe(2_324_577);
    expect(Number(nCarrDep)).toBe(2_324_577);
  }, LONG);

  it('couverture_pays_jsonb (METRO, CP) = somme des départements de métropole (l’écart de 63 684 est comblé)', () => {
    const [cp, dep] = sql(`
      select public.couverture_pays_jsonb('METRO', 'ind', 'cp')->>'population',
             (select round(sum((populations->>'ind')::numeric)) from public.unite_population_totale_e7
               where maille = 'departement' and left(code, 2) not in ('97', '98'));`);
    expect(Math.abs(Number(cp) - Number(dep))).toBeLessThanOrEqual(1);
  }, LONG);

  it('dénominateurs jumeaux : chaque CP, commune et département égale la somme de ses carreaux dans la vue', () => {
    const [ecartsCp, ecartsCommune, ecartsDep] = sql(`
      with cp as (select code_postal code, count(*) n, sum(pops[1]::numeric) ind from public.carreau_couverture_e7 group by 1),
           co as (select code_commune code, count(*) n, sum(pops[1]::numeric) ind from public.carreau_couverture_e7 group by 1),
           de as (select code_departement code, count(*) n, sum(pops[1]::numeric) ind from public.carreau_couverture_e7 group by 1)
      select (select count(*) from cp full join public.cp_population_totale_e7 d on d.code_postal = cp.code
               where cp.code is null or d.code_postal is null or cp.n <> d.n_carreaux
                  or abs(cp.ind - (d.populations->>'ind')::numeric) > 0.5),
             (select count(*) from co full join (select * from public.unite_population_totale_e7 where maille = 'commune') d
                  on d.code = co.code
               where co.code is null or d.code is null or co.n <> d.n_carreaux
                  or abs(co.ind - (d.populations->>'ind')::numeric) > 0.5),
             (select count(*) from de full join (select * from public.unite_population_totale_e7 where maille = 'departement') d
                  on d.code = de.code
               where de.code is null or d.code is null or de.n <> d.n_carreaux
                  or abs(de.ind - (d.populations->>'ind')::numeric) > 0.5);`);
    expect(Number(ecartsCp)).toBe(0);
    expect(Number(ecartsCommune)).toBe(0);
    expect(Number(ecartsDep)).toBe(0);
  }, LONG);

  it('Paris 16e : le carreau du Trocadéro est au CP 75016, à l’arrondissement 75116 et au département 75', () => {
    const [cp, commune, iris, dep] = sql(`
      with p as (select ST_Transform(ST_SetSRID(ST_MakePoint(2.2875, 48.8625), 4326), 3857) g)
      select cc.code_postal, cc.code_commune, left(cc.code_iris, 5), cc.code_departement
        from public.carreau_couverture_e7 cc, p
       where ST_DWithin(cc.centroide_3857, p.g, 150)
       order by ST_Distance(cc.centroide_3857, p.g) limit 1;`);
    expect([cp, commune, iris, dep]).toEqual(['75016', '75116', '75116', '75']);
    expect(sql(`select code_departement from public.cp_population_totale_e7 where code_postal = '75016';`)[0]).toBe('75');
  }, LONG);

  it('CP à cheval sur deux départements : rattaché au département majoritaire en population du CP', () => {
    const [nCheval, faux] = sql(`
      with d as (select code_postal, code_departement, sum(pops[1]::numeric) p, count(*) n
                   from public.carreau_couverture_e7 group by 1, 2),
           m as (select distinct on (code_postal) code_postal, code_departement
                   from d order by code_postal, p desc, n desc, code_departement)
      select count(*) filter (where t.n_departements > 1),
             count(*) filter (where t.code_departement is distinct from m.code_departement)
        from public.cp_population_totale_e7 t join m on m.code_postal = t.code_postal;`);
    expect(Number(nCheval)).toBeGreaterThan(0);
    expect(Number(faux)).toBe(0);
    // Cas connu (mesuré le 03/11) : 52100 Saint-Dizier, 27 028 hab. en Haute-Marne et 740 dans la Marne → 52.
    expect(sql(`select code_departement || ':' || n_departements from public.cp_population_totale_e7
                 where code_postal = '52100';`)[0]).toBe('52:2');
  }, LONG);
});
