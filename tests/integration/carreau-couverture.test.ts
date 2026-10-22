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
