#!/usr/bin/env node
/**
 * C25 (amendement E7, sql/332) — pose les corrections de `carreau_couverture` puis reconstruit les dénominateurs jumeaux.
 *
 * ── CE QU'IL PRODUIT ─────────────────────────────────────────────────────
 *
 * Par lots de `carreau_id` (100 000 par défaut, 24 lots), `construire_carreau_couverture_e7` écrit, sur les SEULS
 * carreaux qui changent :
 *   - `code_commune_e7` : la commune de l'IRIS (IRIS[0:5]) quand elle diffère du premier code de `lcog_geo` ;
 *   - `code_departement_e7` : le département de cette commune quand il diffère ;
 *   - `code_postal_e7` et `distance_cp_e7_m` : le CP au contour le plus proche, pour un carreau sans CP.
 * Puis `construire_denominateurs_e7` reconstruit `unite_population_totale_e7`, `cp_population_totale_e7` (département
 * majoritaire du CP) et `denominateur_menages_min_e7` depuis la vue `carreau_couverture_e7`.
 *
 * La table brute garde ses colonnes d'origine : elle est lue par d'autres branches (base locale PARTAGÉE).
 *
 * ── REPRENABLE ───────────────────────────────────────────────────────────
 *
 * Chaque lot est UNE transaction, journalisée dans `carreau_couverture_e7_lots`. Rejouer un lot n'écrit que ce qui
 * change (rien, la seconde fois). À relancer après toute reconstruction de `carreau_couverture` : tant que les lots
 * sont plus anciens que la dernière bande, le découpage refuse (`denominateur_*_perime`).
 *
 * ⚠ CIBLE : la base LOCALE, par `psql` dans le conteneur (Kong coupe à 60 s, `authenticator` à 8 s).
 *
 * Usage :
 *   node scripts/construire_carreau_couverture_e7.mjs              # tous les lots, puis les dénominateurs
 *   node scripts/construire_carreau_couverture_e7.mjs --lot 12     # un seul lot, puis les dénominateurs
 *   node scripts/construire_carreau_couverture_e7.mjs --taille 50000
 */
import { nb, psql } from './local/psql-conteneur.mjs';

const args = process.argv.slice(2);
const valeur = (nom, defaut) => {
  const i = args.indexOf(nom);
  return i >= 0 ? Number(args[i + 1]) : defaut;
};
const TAILLE = valeur('--taille', 100_000);
const lotSeul = args.includes('--lot') ? valeur('--lot', -1) : null;

const duree = (s) => (s >= 90 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`);

function main() {
  const t0 = Date.now();
  const idMax = Number(psql('select coalesce(max(carreau_id), 0) from public.carreau_couverture'));
  const nLots = Math.ceil(idMax / TAILLE);
  const lots = lotSeul === null ? [...Array(nLots).keys()] : [lotSeul];
  console.log(`[parsing] carreau_couverture : ${nb(idMax)} identifiants, ${nb(lots.length)} lot(s) de ${nb(TAILLE)}`);

  const total = { lus: 0, ecrits: 0, commune: 0, departement: 0, cp: 0, distMax: 0 };
  lots.forEach((lot, i) => {
    const tl = Date.now();
    let r;
    try {
      r = JSON.parse(psql(`select public.construire_carreau_couverture_e7(${lot}, ${TAILLE})::text`));
    } catch (e) {
      console.error(`\nÉCHEC lot ${lot} : ${String(e.stderr || e.message).split('\n')[0]}`);
      console.error('Arrêt. Un lot échoué n\'écrit rien ; relancer reprend sans dégât.');
      process.exit(1);
    }
    if (!r.ok) {
      console.error(`\nREFUS lot ${lot} : ${r.error}`);
      process.exit(1);
    }
    for (const k of ['lus', 'ecrits', 'commune', 'departement', 'cp']) total[k] += r[k];
    total.distMax = Math.max(total.distMax, r.distance_max_m ?? 0);
    const pct = Math.round((100 * (i + 1)) / lots.length);
    console.log(
      `[insertion] ${pct} % · lot ${lot} (${nb(r.id_min)} → ${nb(r.id_max)}) · ${nb(r.lus)} lus, ${nb(r.ecrits)} écrits`
      + ` · communes ${nb(r.commune)}, départements ${nb(r.departement)}, CP ${nb(r.cp)}`
      + ` · ${Math.round((Date.now() - tl) / 1000)} s`,
    );
  });

  console.log('');
  console.log(
    `✓ ${nb(total.lus)} carreaux lus, ${nb(total.ecrits)} lignes écrites en ${duree((Date.now() - t0) / 1000)}`
    + ` · corrections : ${nb(total.commune)} communes, ${nb(total.departement)} départements, ${nb(total.cp)} CP`
    + ` (distance max ${nb(Math.round(total.distMax))} m)`,
  );

  const td = Date.now();
  console.log('[post-traitement] dénominateurs jumeaux (unite_population_totale_e7, cp_population_totale_e7, denominateur_menages_min_e7)');
  let d;
  try {
    d = JSON.parse(psql('select public.construire_denominateurs_e7()::text'));
  } catch (e) {
    console.error(`ÉCHEC dénominateurs : ${String(e.stderr || e.message).split('\n')[0]}`);
    process.exit(1);
  }
  console.log(
    `✓ Dénominateurs : ${Object.entries(d.unites).map(([m, n]) => `${m} ${nb(n)}`).join(', ')}, CP ${nb(d.cp)}`
    + ` (dont ${nb(d.cp_a_cheval)} à cheval sur deux départements), filtré ${nb(d.menages_min)} lignes`
    + ` · ${Math.round((Date.now() - td) / 1000)} s`,
  );
  console.log(`  Population nationale : ${nb(d.pop_cp)} au CP, ${nb(d.pop_departement)} au département`);
  if (Math.abs(d.pop_cp - d.pop_departement) > 1) {
    console.error('✗ Somme au CP différente de la somme au département.');
    process.exit(1);
  }
}

main();
