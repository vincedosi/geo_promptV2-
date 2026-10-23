#!/usr/bin/env node
/**
 * Construit `carreau_risque_distance` (sql/203), bande de longitude par bande.
 *
 * ── CE QU'IL PRODUIT, ET POURQUOI ÇA N'EXISTAIT PAS ──────────────────────
 *
 * Pour chaque carreau INSEE de 200 m proche d'un site Seveso : sa distance au
 * seuil haut le plus proche ET sa distance au seuil bas, dans la MÊME ligne.
 *
 * `couverture_rayon_risque` (sql/198) ne porte que les marges — une ligne par
 * gravité, chacune exacte pour sa propre question. La priorité « haut prime sur
 * bas » a besoin du COUPLE, et aucune agrégation ne permet de reconstituer l'un
 * à partir des autres.
 *
 * Mesuré après construction, le 2026-09-19 : sur **883 451 carreaux** retenus,
 * **317 367 sont à portée des DEUX niveaux**, soit 35,9 %. L'estimation tirée de
 * la table marginale annonçait 328 071 — l'écart vient de ce que `couverture_
 * rayon_risque` s'alimente par accumulation, donc sur-compte une bande rejouée.
 * C'est la mesure sur la table jointe qui fait foi.
 *
 * ── POURQUOI UN SCRIPT, ET PAS UNE ROUTE ─────────────────────────────────
 *
 * C'est un outil de CONSTRUCTION : il tourne une fois après un import de sites
 * ou de périmètres, jamais depuis l'interface. Même famille que
 * `scripts/construire_couverture_rayon.mjs`, dont il reprend les leçons.
 *
 * ── POURQUOI `psql` ET PAS POSTGREST ─────────────────────────────────────
 *
 * Mesuré le 2026-09-18 sur le pré-calcul voisin : Kong, la passerelle HTTP du
 * stack local, coupe à 60 s. Le message est « The upstream server is timing
 * out » et il ne vient PAS de Postgres — desserrer `statement_timeout` côté
 * base n'y change rien, la requête tourne toujours mais plus personne n'attend
 * sa réponse. Un outil de construction n'a aucune raison d'emprunter la
 * passerelle de l'application.
 *
 * ── REPRENABLE ───────────────────────────────────────────────────────────
 *
 * `carreau_risque_bandes` journalise ce qui est fait ; le script saute ces
 * bandes-là. L'insertion étant un `on conflict do update` (et non un ajout),
 * rejouer une bande est SANS DANGER — contrairement à `couverture_rayon_risque`
 * dont les compteurs s'accumulent. C'est pour cela qu'il n'y a pas de
 * `--refaire` ici : `--bande N` suffit.
 *
 * Usage :
 *   node scripts/construire_carreau_risque.mjs             # reprend
 *   node scripts/construire_carreau_risque.mjs --tout      # purge puis tout
 *   node scripts/construire_carreau_risque.mjs --bandes 40 # plus fin
 *   node scripts/construire_carreau_risque.mjs --bande 12  # une seule
 *
 * ⚠ CIBLE : la base LOCALE, toujours. Il n'y a plus de production à viser — le
 * projet hébergé est abandonné (CLAUDE.md). Ne pas rajouter de `--prod` par
 * symétrie avec le script voisin : ce drapeau y existe pour une raison
 * historique qui a cessé de valoir.
 */
import { CONTENEUR, ZONES_LOINTAINES, nb, psql } from './local/psql-conteneur.mjs';

const args = process.argv.slice(2);
const tout = args.includes('--tout');
const iBandes = args.indexOf('--bandes');
const iBande = args.indexOf('--bande');

/**
 * 20 bandes par défaut.
 *
 * Le voisin en prend 120 parce qu'il passe par PostgREST, dont le rôle porte un
 * `statement_timeout` que `set local` ne peut pas prolonger — il est déjà armé
 * quand la fonction démarre. Ici on parle à Postgres directement : la fonction
 * pose elle-même ses 30 minutes, et découper plus fin ne ferait qu'ajouter du
 * coût fixe par bande.
 */
const N = iBandes >= 0 ? Number(args[iBandes + 1]) : 20;

// Zones lointaines : celles de `local/psql-conteneur.mjs`. Leçon du premier passage : -5,5 à 9,8 seulement, et les
// 14 058 carreaux de la Martinique et de La Réunion manquaient sans un message.

function main() {
  if (tout) {
    const r = JSON.parse(psql('select public.vider_carreau_risque_distance()'));
    console.log(`purge : ${nb(r.supprimees)} ligne(s) supprimée(s)`);
  }

  /*
   * Le rattachement des périmètres PPRT à leur niveau est matérialisé, et il
   * doit être à jour AVANT la première bande : la construction le lit, elle ne
   * le calcule pas. Le refaire coûte 51,9 s mesurées — d'où la matérialisation,
   * qui évite de le payer vingt fois.
   */
  const nPprt = Number(psql('select count(*) from public.pprt_niveau_generateur') || 0);
  if (nPprt === 0 || tout) {
    process.stdout.write('rattachement des périmètres PPRT à leur niveau… ');
    const r = JSON.parse(psql('select public.remplir_pprt_niveau_generateur()'));
    console.log(`${nb(r.perimetres)} périmètres, ${nb(r.rattaches)} rattachés`);
    if (r.rattaches < r.perimetres) {
      // Ce n'est pas une anomalie : un périmètre survit à l'exploitant qui l'a
      // généré. Le dire évite qu'on le prenne pour un import incomplet.
      console.log(
        `  (${nb(r.perimetres - r.rattaches)} périmètres sans site Seveso actif à moins `
        + `de 500 m — le générateur a pu cesser son activité)`,
      );
    }
  }

  const faites = new Set(
    (psql("select coalesce(string_agg(bande::text, ','), '') from public.carreau_risque_bandes") || '')
      .split(',').filter(Boolean).map(Number),
  );

  const aFaire = iBande >= 0
    ? [Number(args[iBande + 1])]
    : [...Array(N).keys()].filter((b) => !faites.has(b));

  if (aFaire.length === 0) {
    console.log(`Rien à faire : les ${N} bandes sont construites.`);
  }

  let total = 0;
  for (const b of aFaire) {
    process.stdout.write(`bande ${b + 1}/${N}… `);
    // Arguments NOMMÉS : la fonction en a six, et les passer par position se
    // tromperait au premier ajout. Ce sont des nombres, rien à échapper.
    const r = JSON.parse(
      psql(`select public.construire_carreau_risque_distance(p_bande => ${b}, p_n_bandes => ${N})`),
    );
    if (!r.ok) {
      console.error(`ÉCHEC : ${JSON.stringify(r)}`);
      process.exit(1);
    }
    total += r.lignes;
    console.log(`${nb(r.lignes)} lignes en ${(r.duree_ms / 1000).toFixed(1)} s`);
  }

  // Les zones éloignées, une bande chacune. Sautées si déjà journalisées, comme
  // celles de la métropole.
  for (const z of ZONES_LOINTAINES) {
    if (iBande >= 0 || faites.has(z.id)) continue;
    process.stdout.write(`${z.nom}… `);
    const r = JSON.parse(psql(
      `select public.construire_carreau_risque_distance(`
      + `p_bande => 0, p_n_bandes => 1, `
      + `p_lon_ouest => ${z.ouest}, p_lon_est => ${z.est}, p_bande_id => ${z.id})`));
    if (!r.ok) {
      console.error(`ÉCHEC : ${JSON.stringify(r)}`);
      process.exit(1);
    }
    total += r.lignes;
    console.log(`${nb(r.lignes)} lignes en ${(r.duree_ms / 1000).toFixed(1)} s`);
  }

  const n = Number(psql('select count(*) from public.carreau_risque_distance') || 0);
  const deux = Number(psql(
    'select count(*) from public.carreau_risque_distance '
    + 'where d_haut_m is not null and d_bas_m is not null') || 0);

  console.log(`\n${nb(n)} carreaux en base (${nb(total)} écrits sur cette passe).`);
  console.log(
    `${nb(deux)} sont à portée des DEUX niveaux `
    + `(${((deux / Math.max(n, 1)) * 100).toFixed(1)} %) — c'est exactement ce que `
    + `couverture_rayon_risque ne savait pas exprimer.`,
  );
}

main();
