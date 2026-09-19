#!/usr/bin/env node
/**
 * Rapatrie les 1 100 comptages routiers MESURES de la production.
 * Le pourquoi est dans `scripts/local/09-rapatrier-tmja-reel.sh`, qui l'appelle.
 *
 * Deux mouvements distincts, et la distinction est le coeur du script :
 *   - `radios` et `emetteurs_radio` sont COMPLETEES (upsert sur `id`). Le local
 *     porte 794 emetteurs absents de la prod ; les effacer serait exactement la
 *     perte qu'on repare.
 *   - `emetteur_radio_stations` est REMPLACEE. C'est le produit d'un calcul
 *     (le matching Arcom), pas une saisie : la version de prod fait foi.
 *
 * L'ordre est impose par deux cles etrangeres en cascade : radios, puis
 * emetteurs, puis liaisons. Inverser ferait echouer l'insertion.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const CONTENEUR = process.env.CONTENEUR_PG ?? 'supabase_db_genesis_app';
/**
 * 5 000 EXACTEMENT, et ce n'est pas un choix de confort.
 *
 * PostgREST tronque a 5 000 lignes — pas seulement les RPC, les requetes de
 * TABLE aussi. Mesure du 2026-09-19 : une page de 20 000 en a rendu 5 000, le
 * script a lu `5000 < 20000` comme « fin de table » et s'est arrete a 5 000
 * emetteurs sur 11 836. Les liaisons suivantes ont alors viole la cle
 * etrangere — le seul symptome, et il arrivait une table trop tard.
 *
 * A 5 000 pile, `.range(d, d+4999)` demande exactement le plafond : une page
 * pleine vaut 5 000, une page courte signale vraiment la fin.
 */
const PAGE = 5000;

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
    }),
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const cle = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !cle) {
  console.error('ERREUR : NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente de .env.local');
  process.exit(1);
}
if (url.includes('127.0.0.1') || url.includes('localhost')) {
  console.error('ERREUR : .env.local pointe sur le LOCAL. Ce script lit la PRODUCTION.');
  process.exit(1);
}

const prod = createClient(url, cle, { auth: { persistSession: false } });
const nb = (n) => new Intl.NumberFormat('fr-FR').format(n);

/** Execute du SQL dans le conteneur local et rend la sortie brute. */
function psql(sql) {
  return execFileSync(
    'docker',
    ['exec', CONTENEUR, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tAc', sql],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

/**
 * Charge des lignes dans une table locale via `\copy … from stdin` au format
 * texte JSON : une ligne = un objet JSON, decoupe ensuite par `jsonb_populate_record`.
 *
 * Pourquoi pas du CSV : les colonnes `jsonb` (`audience_data`, `metadata`)
 * portent des guillemets et des virgules, et la geometrie arrive en hexa. Le
 * JSON traverse sans qu'aucun echappement ne soit a inventer.
 */
function chargerJson(lignes, table, cle_conflit) {
  if (lignes.length === 0) return 0;
  const corps = lignes.map((l) => JSON.stringify(l).replace(/\\/g, '\\\\')).join('\n');
  const sql = [
    'create temp table _tampon(doc jsonb);',
    `\\copy _tampon from stdin`,
    corps,
    '\\.',
    cle_conflit
      ? `insert into public.${table} select (jsonb_populate_record(null::public.${table}, doc)).*
           from _tampon on conflict (${cle_conflit}) do nothing;`
      : `insert into public.${table} select (jsonb_populate_record(null::public.${table}, doc)).* from _tampon;`,
    'drop table _tampon;',
  ].join('\n');

  const sortie = execFileSync(
    'docker',
    ['exec', '-i', CONTENEUR, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const m = /INSERT 0 (\d+)/.exec(sortie);
  return m ? Number(m[1]) : 0;
}

/**
 * Lit une table de prod page par page et charge CHAQUE page aussitôt.
 *
 * On n'accumule pas : 569 698 lignes en mémoire puis en une seule entrée psql,
 * c'est ~60 Mo de chaîne sur une VM plafonnée à 3 Go. Une page chargée est une
 * page acquise — une coupure ne coûte que la page en cours.
 */
async function copier(table) {
  let lues = 0;
  let ecrites = 0;
  for (let debut = 0; ; debut += PAGE) {
    const { data, error } = await prod
      .from(table)
      .select('*')
      .order('id', { ascending: true })
      .range(debut, debut + PAGE - 1);
    if (error) throw new Error(`${table} : ${error.message}`);
    lues += data.length;
    ecrites += chargerJson(data, table, 'id');
    process.stdout.write(`\r    ${table} : ${nb(lues)} lues · ${nb(ecrites)} écrites…`);
    if (data.length < PAGE) break;
  }
  process.stdout.write('\n');
  return { lues, ecrites };
}

async function principal() {
  console.log('▶ Rapatriement des comptages routiers MESURÉS : PRODUCTION -> local');
  console.log(`  source : ${url}`);
  console.log('  filtre : source = tmja_rrn_national \n    les 406 930 lignes de proxy OSM sont laissees \n');

  const avant = psql('select count(*) from public.comptages_routiers');
  console.log(`  local avant : ${nb(Number(avant))} lignes`);

  // Rejouable : on efface d'abord ce que CE script aurait pu ecrire, jamais le
  // reste de la table. Un `delete` global emporterait un proxy regenere entre
  // deux passages.
  psql("delete from public.comptages_routiers where source = 'tmja_rrn_national'");

  let lues = 0;
  let ecrites = 0;
  for (let debut = 0; ; debut += PAGE) {
    const { data, error } = await prod
      .from('comptages_routiers')
      .select('*')
      .eq('source', 'tmja_rrn_national')
      .order('id', { ascending: true })
      .range(debut, debut + PAGE - 1);
    if (error) throw new Error(`comptages_routiers : ${error.message}`);
    lues += data.length;
    ecrites += chargerJson(data, 'comptages_routiers', 'id');
    process.stdout.write(`\r    ${nb(lues)} lues · ${nb(ecrites)} ecrites...`);
    if (data.length < PAGE) break;
  }
  process.stdout.write('\n');

  const rapport = psql(`
    select 'total=' || count(*)
        || ' mesures=' || count(*) filter (where source = 'tmja_rrn_national')
        || ' tmja_distincts=' || count(distinct tmja) filter (where source = 'tmja_rrn_national')
        || ' sans_geometrie=' || count(*) filter (where geom is null)
      from public.comptages_routiers`);
  console.log(`✓ ${rapport}`);
  psql('analyze public.comptages_routiers');
}

principal().catch((e) => {
  console.error('\nÉCHEC :', e.message);
  process.exit(1);
});
