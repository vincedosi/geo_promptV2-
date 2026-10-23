#!/usr/bin/env node
/**
 * Construit `carreau_couverture` (sql/266), bande de longitude par bande.
 *
 * ── CE QU'IL PRODUIT ─────────────────────────────────────────────────────
 *
 * Une ligne ÉTROITE par carreau Filosofi (2 324 577) : centroïde 3857, code
 * postal canonique, IRIS, commune, département, 24 effectifs. C'est ce que lit
 * la couverture d'une zone (lot 4, T5) au lieu des 3,2 Go de jsonb de
 * `carreaux_filosofi`. Sans elle, la couverture REFUSE
 * (`couverture_non_construite`) : il n'y a pas de repli, exprès (sql/229).
 *
 * ── POURQUOI UN SCRIPT, ET POURQUOI `psql` ───────────────────────────────
 *
 * Outil de CONSTRUCTION : il tourne après un rechargement des carreaux, des
 * contours de CP ou des IRIS, jamais depuis l'interface. Il parle à Postgres
 * par `psql` dans le conteneur : Kong, la passerelle HTTP du stack local,
 * coupe à 60 s (mesuré le 2026-09-18, `construire_couverture_rayon.mjs`), et
 * le rôle `authenticator` porte un `statement_timeout` de 8 s.
 *
 * ⚠ CIBLE : la base LOCALE, toujours. Pas de `--prod` : le projet hébergé est
 * supprimé (CLAUDE.md), et un chemin mort ne s'écrit pas.
 *
 * ── REPRENABLE ───────────────────────────────────────────────────────────
 *
 * `carreau_couverture_bandes` journalise chaque bande ; le script saute celles
 * qui y sont. Une bande est UNE transaction : interrompue, elle n'écrit rien et
 * n'est pas journalisée. L'insertion REMPLACE (la clé est le carreau) : rejouer
 * une bande avec `--bande N` est sans danger.
 *
 * ⚠ CERTIFIÉE EN FIN DE COURSE (sql/268). Le journal s'accorde TOUJOURS avec
 * la table (même transaction) : il ne prouve pas qu'elle est complète. Le
 * script compte donc la table contre `carreaux_filosofi` à la fin et range un
 * certificat ; sans lui, la couverture refuse. Puis il reconstruit le
 * dénominateur IRIS (sql/267), qui dérive de cette table.
 *
 * ⚠ Changer le nombre de bandes impose `--tout` : le journal additionne les
 * carreaux par bande, et deux découpages superposés le feraient mentir (la
 * table, elle, resterait juste). Le nombre précédent se déduit de la largeur
 * d'une bande du journal.
 *
 * ── LA MÉMOIRE DU POSTE ──────────────────────────────────────────────────
 *
 * Mesuré le 22/10 : 141 Mo libres au démarrage du stack. Avant chaque bande, le
 * script lit la mémoire libre de l'hôte et S'ARRÊTE sous 300 Mo (seuil
 * `--ram-min`) : relancer plus tard reprend là où il s'est arrêté.
 *
 * Usage :
 *   node scripts/construire_carreau_couverture.mjs              # reprend
 *   node scripts/construire_carreau_couverture.mjs --tout       # purge puis tout
 *   node scripts/construire_carreau_couverture.mjs --bandes 48  # plus fin (avec --tout)
 *   node scripts/construire_carreau_couverture.mjs --bande 12   # une seule, rejouée
 */
import { freemem } from 'node:os';
import { CONTENEUR, ZONES_LOINTAINES, nb, psql } from './local/psql-conteneur.mjs';

const args = process.argv.slice(2);
const tout = args.includes('--tout');
if (tout && args.includes('--bande')) {
  // `--tout` purge la table : une seule bande rejouée derrière laisserait le reste vide (relecture de T3, r4).
  console.error('ERREUR : --tout et --bande N ne se combinent pas (la purge effacerait toutes les autres bandes).');
  process.exit(1);
}
const valeur = (nom, defaut) => {
  const i = args.indexOf(nom);
  return i >= 0 ? Number(args[i + 1]) : defaut;
};
/**
 * 24 bandes par défaut : mesuré le 22/10, la plus dense (Paris, 2,15° → 2,79°)
 * porte 180 817 carreaux et prend 24 s. Si une bande dépasse 120 s, passer à
 * `--bandes 48 --tout`.
 */
const N = valeur('--bandes', 24);
const bandeSeule = args.includes('--bande') ? valeur('--bande', -1) : null;
const RAM_MIN_MO = valeur('--ram-min', 300);

/** Bornes de la métropole : celles des paramètres par défaut de la fonction SQL. */
const OUEST = -5.5;
const EST = 9.8;

const deg = (x) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(x);
const duree = (s) => (s >= 90 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`);

/** Attente synchrone (le script est séquentiel de bout en bout). */
const attendre = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * S'arrête proprement si la mémoire libre de l'hôte RESTE sous le seuil.
 *
 * « Reste » : mesuré le 22/10, la mémoire disponible de Windows oscille de
 * plusieurs centaines de Mo en quelques secondes (149 Mo lus avant la bande 6,
 * 1 034 Mo une minute plus tard). Une lecture isolée arrêtait la construction
 * sur un creux passager ; on la relit donc jusqu'à 6 fois, 5 s d'écart.
 */
function verifierMemoire(avant) {
  let libre = Math.round(freemem() / 1024 / 1024);
  for (let essai = 0; libre < RAM_MIN_MO && essai < 6; essai++) {
    attendre(5000);
    libre = Math.round(freemem() / 1024 / 1024);
  }
  if (libre < RAM_MIN_MO) {
    console.error(
      `\nARRÊT avant ${avant} : ${nb(libre)} Mo libres sur l'hôte, sous le seuil de ${RAM_MIN_MO} Mo. `
      + 'Rien n\'est perdu : relancer le script reprend à cette bande.',
    );
    process.exit(2);
  }
  return libre;
}

/** Une bande ; s'arrête au premier échec (une bande échouée n'est pas journalisée). */
function construire(argsSql, libelle) {
  let r;
  try {
    r = JSON.parse(psql(`select public.construire_carreau_couverture(${argsSql})`));
  } catch (e) {
    console.error(`\nÉCHEC ${libelle} : ${String(e.stderr || e.message).split('\n')[0]}`);
    console.error('Arrêt. Vérifier le stack (bash scripts/local/12-sante.sh), puis relancer : le script reprend.');
    process.exit(1);
  }
  if (!r.ok) {
    console.error(`\nÉCHEC ${libelle} : ${JSON.stringify(r)}`);
    process.exit(1);
  }
  return r;
}

function main() {
  console.log(`▶ Construction de carreau_couverture — ${N} bandes + ${ZONES_LOINTAINES.length} zones lointaines`);
  console.log(`  cible : base LOCALE (${CONTENEUR}) · mémoire libre ${nb(Math.round(freemem() / 1048576))} Mo`);

  if (!tout) {
    const l = psql(
      "select lon_min::text || '|' || lon_max::text from public.carreau_couverture_bandes "
      + 'where bande < 1000 limit 1',
    );
    if (l) {
      const [a, b] = l.split('|').map(Number);
      const nPrecedent = Math.round((EST - OUEST) / (b - a));
      if (nPrecedent !== N) {
        console.error(
          `ERREUR : le journal a été construit avec ${nPrecedent} bandes, pas ${N}. `
          + 'Deux découpages superposés feraient mentir le journal — relancer avec --tout.',
        );
        process.exit(1);
      }
    }
  }

  if (tout) {
    console.log(`  purge : ${nb(Number(psql('select public.vider_carreau_couverture()') || 0))} ligne(s) effacée(s)`);
  }

  const faites = new Set(
    (psql("select coalesce(string_agg(bande::text, ','), '') from public.carreau_couverture_bandes") || '')
      .split(',').filter(Boolean).map(Number),
  );
  if (faites.size > 0 && bandeSeule === null) console.log(`  ${faites.size} bande(s) déjà construite(s), sautée(s)`);

  const aFaire = bandeSeule !== null
    ? [bandeSeule]
    : [...Array(N).keys()].filter((b) => !faites.has(b));

  const t0 = Date.now();
  let total = 0;
  let lente = { libelle: '—', s: 0 };
  let faitesIci = 0;

  for (const b of aFaire) {
    const lonMin = OUEST + ((EST - OUEST) * b) / N;
    const lonMax = OUEST + ((EST - OUEST) * (b + 1)) / N;
    const libelle = `bande ${b + 1}/${N}`;
    const libre = verifierMemoire(libelle);
    const tb = Date.now();
    const r = construire(`p_bande => ${b}, p_n_bandes => ${N}`, libelle);
    const s = (Date.now() - tb) / 1000;
    total += r.carreaux;
    faitesIci++;
    if (s > lente.s) lente = { libelle, s };
    const moyenne = (Date.now() - t0) / 1000 / faitesIci;
    const reste = moyenne * (aFaire.length - faitesIci);
    console.log(
      `[${libelle}] lon ${deg(lonMin)} → ${deg(lonMax)} · ${nb(r.carreaux)} carreaux `
      + `(sans CP ${nb(r.sans_cp)}, sans IRIS ${nb(r.sans_iris)}) · ${Math.round(s)} s · `
      + `reste ≈ ${duree(reste)} · ${nb(libre)} Mo libres`,
    );
    if (s > 120) {
      console.log(`  ⚠ ${libelle} a dépassé 120 s : envisager --bandes ${N * 2} --tout`);
    }
  }

  for (const z of ZONES_LOINTAINES) {
    if (bandeSeule !== null || faites.has(z.id)) continue;
    verifierMemoire(z.nom);
    const tz = Date.now();
    const r = construire(
      `p_bande => 0, p_n_bandes => 1, p_lon_ouest => ${z.ouest}, p_lon_est => ${z.est}, p_bande_id => ${z.id}`,
      z.nom,
    );
    const s = (Date.now() - tz) / 1000;
    total += r.carreaux;
    if (s > lente.s) lente = { libelle: z.nom, s };
    console.log(
      `[zone] ${z.nom} · ${nb(r.carreaux)} carreaux (sans CP ${nb(r.sans_cp)}, sans IRIS ${nb(r.sans_iris)}) · ${Math.round(s)} s`,
    );
  }

  const [n, attendu, nb_bandes, taille] = psql(
    "select (select count(*) from public.carreau_couverture)::text || '|' || "
    + "(select count(*) from public.carreaux_filosofi)::text || '|' || "
    + "(select count(*) from public.carreau_couverture_bandes)::text || '|' || "
    + "pg_size_pretty(pg_total_relation_size('public.carreau_couverture'))",
  ).split('|');

  console.log('');
  console.log(`✓ ${nb(total)} carreaux écrits en ${duree((Date.now() - t0) / 1000)} · bande la plus lente : ${lente.libelle} (${Math.round(lente.s)} s)`);
  console.log(`  ${nb(Number(n))} lignes en table sur ${nb(Number(attendu))} carreaux Filosofi · ${nb_bandes} bandes au journal · ${taille}`);
  if (bandeSeule === null && Number(n) !== Number(attendu)) {
    console.error(`✗ La table ne couvre pas tous les carreaux (${nb(Number(attendu) - Number(n))} manquants).`);
    process.exit(1);
  }

  /*
   * CERTIFIER (sql/268). Tant que la table n'est pas certifiée complète, la
   * couverture d'une zone REFUSE (`couverture_non_construite`) et le
   * dénominateur IRIS ne se construit pas : un `--tout` interrompu laisse une
   * table partielle MAIS cohérente avec son journal — seul un compte contre
   * `carreaux_filosofi`, rangé ici une fois, le voit (relecture de T4, 22/10).
   * Toute bande écrite après invalide le certificat : on certifie donc aussi
   * après une `--bande N` rejouée.
   */
  const cert = JSON.parse(psql('select public.certifier_carreau_couverture()::text'));
  if (!cert.complete) {
    console.error(
      `✗ Certificat refusé : ${nb(cert.n_lignes)} lignes, ${nb(cert.n_journal)} au journal, `
      + `${nb(cert.n_carreaux_filosofi)} carreaux Filosofi. La couverture restera refusée.`,
    );
    process.exit(1);
  }
  console.log(`✓ Table certifiée complète (${nb(cert.n_lignes)} lignes, ${cert.n_bandes} bandes)`);

  /*
   * LE DÉNOMINATEUR IRIS SUIT (sql/267). Il est construit DEPUIS cette table :
   * relancer ce script seul le laissait plus ancien que le journal, sans que
   * rien ne le signale hors de `11-reconstruire.sh`. Il est donc reconstruit
   * ici, à chaque construction (≈ 18 s) ; et `couverture_geometrie` (sql/269)
   * refuse quand même le découpage IRIS sur un dénominateur plus ancien que le
   * journal — la seconde garde vaut pour tout autre chemin (restauration…).
   */
  const ti = Date.now();
  const d = JSON.parse(psql('select public.construire_denominateur_iris()::text'));
  console.log(`✓ Dénominateur IRIS reconstruit : ${nb(d.n_iris)} IRIS, ${nb(d.n_carreaux)} carreaux · ${Math.round((Date.now() - ti) / 1000)} s`);
}

main();
