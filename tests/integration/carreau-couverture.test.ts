/**
 * `carreau_couverture` (lot 4, T3, arbitrage A-1) — une ligne ÉTROITE par carreau Filosofi : centroïde 3857, code postal
 * canonique, IRIS, commune, département, 24 effectifs `real[]`. C'est la table que `couverture_geometrie` (T5) lira pour
 * chiffrer n'importe quelle zone sans relire les 3,2 Go de jsonb de `carreaux_filosofi`.
 *
 * Ce fichier prouve que la table compte EXACTEMENT comme les dénominateurs existants — sans quoi une part de territoire
 * pourrait dépasser 100 % ou ne jamais l'atteindre :
 *   - par code postal, chaque CP égale `cp_population_totale` (même règle `cp_des_points`, sql/228) ;
 *   - par commune et par département, chaque unité égale `unite_population_totale` (premier code de `lcog_geo`,
 *     sql/221 ; le département dérivé à 3 caractères pour `97x`/`98x`).
 *
 * Les requêtes passent par psql dans le conteneur (comme `perimetres-sans-interstices.test.ts`) : la table n'est lisible
 * que par `service_role` et ces lectures portent sur des millions de lignes, hors de portée de PostgREST (1 000 lignes).
 */
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const CONTENEUR = process.env.CONTENEUR_PG ?? 'supabase_db_genesis_app';
const LONG = 180_000;

/** Une requête, une ligne de résultat, colonnes séparées par « | ». Lève si psql échoue. */
function sql(requete: string): string[] {
  const r = spawnSync('docker', ['exec', '-i', CONTENEUR, 'psql', '-U', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], {
    input: requete,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`psql (${r.status}) : ${r.stderr}`);
  return r.stdout.trim().split('|');
}

describe('sql/266 — carreau_couverture', () => {
  it('une ligne par carreau Filosofi, 24 effectifs chacune, aucun centroïde absent', () => {
    const [n, attendu, sansPops, mauvaiseLongueur] = sql(`
      select (select count(*) from public.carreau_couverture),
             (select count(*) from public.carreaux_filosofi),
             (select count(*) from public.carreau_couverture where pops is null),
             (select count(*) from public.carreau_couverture
               where array_length(pops, 1) is distinct from (select count(*) from public.cibles_exposition where rang_pop is not null));`);
    expect(Number(attendu)).toBe(2_324_577);
    expect(Number(n)).toBe(Number(attendu));
    expect(Number(sansPops)).toBe(0);
    expect(Number(mauvaiseLongueur)).toBe(0);
  }, LONG);

  it('pops[rang_pop] = metadata->>code pour les 24 cibles (A-2), sur 200 carreaux de métropole et 200 d’outre-mer', () => {
    const [n, ecarts] = sql(`
      with ech as (
        (select carreau_id from public.carreau_couverture where code_departement not like '97%' order by carreau_id limit 200)
        union all
        (select carreau_id from public.carreau_couverture where code_departement like '97%' order by carreau_id limit 200))
      select count(*),
             count(*) filter (where abs(cc.pops[k.rang_pop] - coalesce((c.metadata->>k.code)::real, 0)) > 1e-4)
        from ech e
        join public.carreau_couverture cc on cc.carreau_id = e.carreau_id
        join public.carreaux_filosofi c on c.id = e.carreau_id
        cross join public.cibles_exposition k
       where k.rang_pop is not null;`);
    expect(Number(n)).toBe(400 * 24);
    expect(Number(ecarts)).toBe(0);
  }, LONG);

  it('par code postal : chaque CP égale cp_population_totale (ind, men et nombre de carreaux), même règle', () => {
    const [nCp, absents, ecarts] = sql(`
      with t as (
        select code_postal, count(*) n, sum(pops[1]::numeric) ind, sum(pops[17]::numeric) men
          from public.carreau_couverture where code_postal is not null group by code_postal)
      select count(*) filter (where t.code_postal is not null),
             count(*) filter (where t.code_postal is null or d.code_postal is null),
             count(*) filter (where t.n <> d.n_carreaux
                                 or abs(t.ind - (d.populations->>'ind')::numeric) > 0.5
                                 or abs(t.men - (d.populations->>'men')::numeric) > 0.5)
        from t full join public.cp_population_totale d on d.code_postal = t.code_postal;`);
    // `pops[17]` est `men` : vérifié par le test A-2 ci-dessus, qui compare chaque rang à son code.
    expect(sql(`select rang_pop from public.cibles_exposition where code = 'men';`)[0]).toBe('17');
    expect(Number(nCp)).toBe(Number(sql('select count(*) from public.cp_population_totale;')[0]));
    expect(Number(absents)).toBe(0);
    expect(Number(ecarts)).toBe(0);
  }, LONG);

  it.each(['commune', 'departement'])('par %s : chaque unité égale unite_population_totale (ind, men_pauv, carreaux)', (maille) => {
    const colonne = maille === 'commune' ? 'code_commune' : 'code_departement';
    const [absents, ecarts] = sql(`
      with t as (
        select ${colonne} code, count(*) n, sum(pops[1]::numeric) ind, sum(pops[23]::numeric) mp
          from public.carreau_couverture group by 1)
      select count(*) filter (where t.code is null or d.code is null),
             count(*) filter (where t.n <> d.n_carreaux
                                 or abs(t.ind - (d.populations->>'ind')::numeric) > 0.5
                                 or abs(t.mp - (d.populations->>'men_pauv')::numeric) > 0.5)
        from t full join (select * from public.unite_population_totale where maille = '${maille}') d on d.code = t.code;`);
    expect(sql(`select rang_pop from public.cibles_exposition where code = 'men_pauv';`)[0]).toBe('23');
    expect(Number(absents)).toBe(0);
    expect(Number(ecarts)).toBe(0);
  }, LONG);

  it('carreaux sans code postal : au plus 0,2 % (99,83 % rattachés, sql/207) ; tous les codes sont CANONIQUES', () => {
    const [n, sansCp, nonCanon] = sql(`
      select count(*), count(*) filter (where code_postal is null),
             count(*) filter (where code_postal is not null and not exists (
               select 1 from public.cp_groupe g where g.code_postal = cc.code_postal and g.code_canonique = cc.code_postal))
        from public.carreau_couverture cc;`);
    expect(Number(sansCp) / Number(n)).toBeLessThanOrEqual(0.002);
    expect(Number(nonCanon)).toBe(0);
  }, LONG);

  it('carreaux sans IRIS : comptés (une poignée, les carreaux de littoral hors contour)', () => {
    const [n, sansIris, iris] = sql(`
      select count(*), count(*) filter (where code_iris is null), count(distinct code_iris) from public.carreau_couverture;`);
    // Mesuré le 22/10 à la construction : 3 879 carreaux sans IRIS (0,17 %, presque tous aussi sans CP — littoral),
    // 48 872 IRIS distincts, 0 carreau dans deux IRIS. Le plafond tient la même tolérance que le CP.
    expect(Number(sansIris) / Number(n)).toBeLessThanOrEqual(0.002);
    expect(Number(iris)).toBeGreaterThan(45_000);
    expect(Number(iris)).toBeLessThanOrEqual(49_448);
  }, LONG);

  it('le journal des bandes couvre toute la table et porte une date (lue par le cache de T6)', () => {
    const [somme, n, sansDate] = sql(`
      select (select sum(n_carreaux) from public.carreau_couverture_bandes),
             (select count(*) from public.carreau_couverture),
             (select count(*) from public.carreau_couverture_bandes where construit_le is null);`);
    expect(Number(somme)).toBe(Number(n));
    expect(Number(sansDate)).toBe(0);
  }, LONG);

  it('fermée à anon et authenticated, lisible par service_role ; construction réservée à service_role', () => {
    const [anon, auth, sr, rls, fnAnon, fnSr] = sql(`
      select has_table_privilege('anon', 'public.carreau_couverture', 'select'),
             has_table_privilege('authenticated', 'public.carreau_couverture', 'select'),
             has_table_privilege('service_role', 'public.carreau_couverture', 'select'),
             (select relrowsecurity from pg_class where oid = 'public.carreau_couverture'::regclass),
             has_function_privilege('anon', 'public.construire_carreau_couverture(int, int, numeric, numeric, int)', 'execute'),
             has_function_privilege('service_role', 'public.construire_carreau_couverture(int, int, numeric, numeric, int)', 'execute');`);
    expect([anon, auth, sr, rls, fnAnon, fnSr]).toEqual(['f', 'f', 't', 't', 'f', 't']);
  }, LONG);
});

/**
 * `carreau_couverture.code_iris` est-il JUSTE ? (relecture de T3, réserve r7)
 *
 * Le dénominateur IRIS de sql/267 est construit DEPUIS cette colonne : si elle était fausse, numérateur et dénominateur
 * seraient faux ENSEMBLE et l'égalité IRIS par IRIS plus bas passerait quand même. On la recalcule donc par la
 * géométrie, sans rien relire de la table étroite que l'identifiant et les codes à contrôler : centroïde refait depuis
 * `carreaux_filosofi.geom_3857`, IRIS cherchés dans `iris.geom` (4326), et TOUS ceux qui contiennent le point comptés.
 * Attendu : exactement un IRIS — le même — quand le code est posé, aucun quand il est NULL. Un carreau rattaché à tort,
 * ou tombé dans deux IRIS, échoue.
 *
 * Échantillon : 1 % des PAGES (`tablesample system`, graine fixe), ≈ 24 000 carreaux, ≈ 6 s. Il doit contenir des
 * carreaux sans IRIS ET des carreaux dont l'IRIS n'est pas dans leur commune (`left(code_iris, 5) <> code_commune`,
 * ≈ 2,3 %) : ce sont les cas où une erreur se cacherait, on exige qu'ils y soient.
 */
describe('sql/266 — exactitude de carreau_couverture.code_iris (recalcul géométrique indépendant)', () => {
  it('sur ≈ 24 000 carreaux tirés : un IRIS et le même quand code_iris est posé, aucun quand il est NULL ; centroïde exact', () => {
    const [n, ok, nuls, nonEmboites, centroideFaux] = sql(`
      with ech as (
        select cc.carreau_id, cc.code_iris, cc.code_commune, cc.centroide_3857,
               ST_Centroid(c.geom_3857) as ctr
          from public.carreau_couverture cc tablesample system (1) repeatable (267)
          join public.carreaux_filosofi c on c.id = cc.carreau_id),
      r as (
        select e.*, x.n_contenants, x.plus_petit
          from ech e
          cross join lateral (
            select count(*) as n_contenants, min(i.code_iris) as plus_petit
              from public.iris i
             where i.geom && ST_Transform(e.ctr, 4326) and ST_Contains(i.geom, ST_Transform(e.ctr, 4326))) x)
      select count(*),
             count(*) filter (where n_contenants = case when code_iris is null then 0 else 1 end
                                and code_iris is not distinct from plus_petit),
             count(*) filter (where code_iris is null),
             count(*) filter (where left(code_iris, 5) <> code_commune),
             count(*) filter (where ST_Distance(centroide_3857, ctr) > 1e-6)
        from r;`);
    expect(Number(n)).toBeGreaterThan(15_000);
    expect(Number(ok)).toBe(Number(n));
    expect(Number(nuls)).toBeGreaterThan(0);
    expect(Number(nonEmboites)).toBeGreaterThan(100);
    expect(Number(centroideFaux)).toBe(0);
  }, LONG);
});

/**
 * sql/267 — le dénominateur IRIS (lot 4, T4, arbitrage A-3) : `unite_population_totale`, maille `iris`, construite DEPUIS
 * `carreau_couverture`. La part d'un IRIS couverte par une zone se rapporte à la population de cet IRIS comptée par la
 * MÊME règle (centroïde dans `iris.geom`) — jamais `iris.population` (recensement), qui ne compte pas la même chose.
 *
 * ⚠ IRIS et commune NE S'EMBOÎTENT PAS ici : pour ≈ 2,3 % des carreaux, le code de l'IRIS qui contient le centroïde ne
 * commence pas par le premier code `lcog_geo` (bordures, et millésimes COG différents entre `iris` et le carroyage). On
 * ne recoupe donc JAMAIS la somme des IRIS d'une commune avec la commune : chaque IRIS se recoupe avec sa propre maille,
 * et le total national se recoupe (IRIS + hors IRIS = total communal).
 *
 * Tout se vérifie en LECTURE : reconstruire le dénominateur à chaque passe réécrivait 48 872 lignes (≈ 20 s, règle
 * I/O). Le refus d'une table non certifiée est prouvé dans une transaction annulée (`carreau-couverture-complete`).
 */
describe('sql/267 — dénominateur IRIS (unite_population_totale, maille iris)', () => {
  it('une ligne par IRIS habité, entre 45 000 et 49 448, autant que d’IRIS dans carreau_couverture ; 24 cibles chacune', () => {
    const [n, attendu, inconnus, mauvaisesCles] = sql(`
      select (select count(*) from public.unite_population_totale where maille = 'iris'),
             (select count(distinct code_iris) from public.carreau_couverture),
             (select count(*) from public.unite_population_totale u
               where u.maille = 'iris' and not exists (select 1 from public.iris i where i.code_iris = u.code)),
             (select count(*) from public.unite_population_totale u
               where u.maille = 'iris'
                 and (select count(*) from jsonb_object_keys(u.populations))
                     <> (select count(*) from public.cibles_exposition where actif and rang_pop is not null));`);
    expect(Number(n)).toBeGreaterThanOrEqual(45_000);
    expect(Number(n)).toBeLessThanOrEqual(49_448);
    expect(Number(n)).toBe(Number(attendu));
    expect(Number(inconnus)).toBe(0);
    expect(Number(mauvaisesCles)).toBe(0);
  }, LONG);

  it('IRIS par IRIS : le dénominateur égale la somme des carreaux de cet IRIS (ind, men, men_pauv, carreaux) — aucune part > 100 % possible', () => {
    const [absents, ecarts] = sql(`
      with t as (
        select code_iris code, count(*) n, sum(pops[1]::numeric) ind, sum(pops[17]::numeric) men, sum(pops[23]::numeric) mp
          from public.carreau_couverture where code_iris is not null group by 1)
      select count(*) filter (where t.code is null or d.code is null),
             count(*) filter (where t.n <> d.n_carreaux
                                 or abs(t.ind - (d.populations->>'ind')::numeric) > 0.5
                                 or abs(t.men - (d.populations->>'men')::numeric) > 0.5
                                 or abs(t.mp - (d.populations->>'men_pauv')::numeric) > 0.5)
        from t full join (select * from public.unite_population_totale where maille = 'iris') d on d.code = t.code;`);
    // `pops[1]`, `pops[17]`, `pops[23]` = ind, men, men_pauv : vérifié par le test A-2 et les deux tests par CP / commune.
    expect(Number(absents)).toBe(0);
    expect(Number(ecarts)).toBe(0);
  }, LONG);

  it('total national : IRIS + carreaux hors IRIS = total communal (63,8 M), au carreau près', () => {
    const [nIris, indIris, nHors, indHors, nComm, indComm] = sql(`
      select (select sum(n_carreaux) from public.unite_population_totale where maille = 'iris'),
             (select sum((populations->>'ind')::numeric) from public.unite_population_totale where maille = 'iris'),
             (select count(*) from public.carreau_couverture where code_iris is null),
             (select coalesce(sum(pops[1]::numeric), 0) from public.carreau_couverture where code_iris is null),
             (select sum(n_carreaux) from public.unite_population_totale where maille = 'commune'),
             (select sum((populations->>'ind')::numeric) from public.unite_population_totale where maille = 'commune');`);
    expect(Number(nIris) + Number(nHors)).toBe(Number(nComm));
    // `pops` est en `real` : ≈ 7 chiffres significatifs par carreau. Sur 2,3 M de carreaux l'écart cumulé reste sous
    // quelques habitants ; l'égalité IRIS par IRIS au demi-habitant près est assurée par le test précédent.
    expect(Math.abs(Number(indIris) + Number(indHors) - Number(indComm))).toBeLessThan(5);
  }, LONG);

  it('construction réservée à service_role', () => {
    const [anon, auth, sr] = sql(`
      select has_function_privilege('anon', 'public.construire_denominateur_iris()', 'execute'),
             has_function_privilege('authenticated', 'public.construire_denominateur_iris()', 'execute'),
             has_function_privilege('service_role', 'public.construire_denominateur_iris()', 'execute');`);
    expect([anon, auth, sr]).toEqual(['f', 'f', 't']);
  }, LONG);
});
