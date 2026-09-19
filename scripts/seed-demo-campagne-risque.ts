#!/usr/bin/env node
/**
 * Jeu de démonstration de l'onglet « Diffusion » du module risque industriel.
 *
 * ── POURQUOI IL EXISTE ───────────────────────────────────────────────────
 *
 * Il n'y a AUCUNE campagne réelle croisant le risque industriel en base. Sans
 * jeu de données, l'onglet Diffusion ne montre qu'un écran vide, et rien ne
 * permet de juger s'il raconte quelque chose.
 *
 * ── CE QU'IL FAIT, ET CE QU'IL DÉLÈGUE ───────────────────────────────────
 *
 * Il orchestre et rend compte ; l'écriture elle-même est ENSEMBLISTE, dans
 * `seed_campagne_risque_demo()` (sql/208). La raison est mesurable : 30 jours
 * × 2 000 codes postaux font 60 000 lignes, et le patron d'insertion du projet
 * est par lots de 50 (`lib/import/inserter.ts`) — 1 200 allers-retours. C'est
 * aussi le patron déjà retenu pour l'autre jeu de démonstration du projet
 * (sql/112).
 *
 * ── LE SCÉNARIO EST DÉLIBÉRÉ ─────────────────────────────────────────────
 *
 * L'écran doit raconter quelque chose :
 *   · sur-pression de +45 % sur trois régions (Île-de-France, Rhône, PACA) ;
 *   · SOUS-pression de −45 % là où plus d'un quart de la population du code
 *     postal est exposée au seuil haut.
 *
 * Le second point est le cas d'usage du module : une campagne qui évite — ou
 * sur-presse — les zones à risque sans le savoir. Un jeu uniforme donnerait un
 * indice de pression à 100 partout, c'est-à-dire un écran qui ne montre rien.
 *
 * ── REPRODUCTIBLE ────────────────────────────────────────────────────────
 *
 * Le bruit vient de `md5(code_postal || jour)`, jamais de `random()`. Deux
 * exécutions donnent exactement le même jeu : une capture d'écran reste
 * valable, et une régression se voit.
 *
 * Usage :
 *   npx tsx scripts/seed-demo-campagne-risque.ts           # crée ou remplace
 *   npx tsx scripts/seed-demo-campagne-risque.ts --purger  # retire le jeu
 *
 * ⚠ CIBLE : la base LOCALE, toujours. Il n'y a plus de production à viser — le
 * projet hébergé est abandonné (`CLAUDE.md`). Ne pas ajouter de `--prod` par
 * symétrie avec les autres scripts : ce drapeau y existe pour une raison
 * historique qui a cessé de valoir.
 */
import { execFileSync } from 'node:child_process';

const CONTENEUR = process.env.CONTENEUR_PG ?? 'supabase_db_genesis_app';
const purger = process.argv.includes('--purger');

function psql(sql: string): string {
  // Pas de `-i` : `psql -c` ne lit jamais l'entrée standard, et lui passer
  // celle du script le ferait bloquer quand elle est fermée.
  return execFileSync(
    'docker',
    ['exec', CONTENEUR, 'psql', '-U', 'postgres', '-d', 'postgres',
     '-v', 'ON_ERROR_STOP=1', '-tAc', sql],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

const nb = (n: number) => new Intl.NumberFormat('fr-FR').format(n);

function main(): void {
  if (purger) {
    const r = JSON.parse(psql('select public.purger_campagne_risque_demo()'));
    console.log(`Jeu de démonstration retiré : ${nb(r.lignes_supprimees)} ligne(s).`);
    return;
  }

  /*
   * Le dénominateur par code postal doit exister AVANT le seed : le scénario
   * s'appuie sur la part de population exposée de chaque code postal, et sans
   * lui la fonction refuse plutôt que de produire un jeu sans relief.
   */
  const denominateur = Number(psql('select count(*) from public.cp_population_totale') || 0);
  if (denominateur === 0) {
    console.error('ERREUR : cp_population_totale est vide.');
    console.error('        Construire le dénominateur d’abord :');
    console.error('        select public.remplir_cp_population_totale(b, N) pour chaque bande.');
    process.exit(1);
  }

  const distances = Number(psql('select count(*) from public.carreau_risque_distance') || 0);
  if (distances === 0) {
    console.error('ERREUR : carreau_risque_distance est vide.');
    console.error('        node scripts/construire_carreau_risque.mjs');
    process.exit(1);
  }

  process.stdout.write('écriture du jeu de démonstration… ');
  const r = JSON.parse(psql('select public.seed_campagne_risque_demo()'));
  if (!r.ok) {
    console.error(`\nÉCHEC : ${JSON.stringify(r)}`);
    process.exit(1);
  }

  console.log(`${nb(r.lignes)} lignes en ${(r.duree_ms / 1000).toFixed(1)} s`);
  console.log(`  campagne      ${r.campagne}`);
  console.log(`  période       ${r.jours} jours`);
  console.log(`  codes postaux ${nb(r.codes_postaux)} (les plus peuplés)`);

  // On relit ce qui a été écrit plutôt que d'afficher ce qu'on croit avoir
  // écrit : un rollup absent rendrait l'onglet vide sur une campagne pleine.
  const rollup = Number(psql(
    `select count(*) from public.campaign_cp_rollup
      where campaign_id = '${r.campagne}'`) || 0);
  console.log(`  rollups CP    ${nb(rollup)}`);
  if (rollup === 0) {
    console.error('\n⚠ Aucun rollup : l’onglet Diffusion lira zéro impression sur une');
    console.error('  campagne pleine. Vérifier refresh_campaign_rollups.');
    process.exit(1);
  }

  console.log('\nLe jeu porte is_demo = true : l’écran doit afficher le badge');
  console.log('« Données de démonstration ». Retrait : --purger');
}

main();
