#!/usr/bin/env node
/**
 * Construit `couverture_rayon_risque`, bande par bande.
 *
 * ── POURQUOI UN SCRIPT ET PAS UNE ROUTE ───────────────────────────────────
 *
 * C'est un outil de CONSTRUCTION, pas une fonctionnalité : il tourne une fois
 * après un import ICPE, jamais depuis l'interface. Même famille que
 * `scripts/populate_carreaux_1km.ts`.
 *
 * Il existe aussi parce que les bandes denses prennent 20 à 30 s et que les
 * appels successifs par un client à délai court les annulent — une transaction
 * interrompue n'écrit rien, et on repart de zéro.
 *
 * ── REPRENABLE ────────────────────────────────────────────────────────────
 *
 * `couverture_rayon_bandes` journalise ce qui est fait. Le script saute ces
 * bandes-là, sauf `--refaire`. Une interruption ne coûte donc que la bande en
 * cours.
 *
 * ⚠ L'insertion est ADDITIVE (`on conflict do update` accumule) pour qu'une
 * bande puisse être rejouée seule. Refaire une bande DÉJÀ construite sans
 * purger doublerait donc ses chiffres — d'où le saut par défaut, et le
 * `vider_couverture_rayon()` qu'impose `--tout`.
 *
 * Usage :
 *   node scripts/construire_couverture_rayon.mjs              # reprend
 *   node scripts/construire_couverture_rayon.mjs --tout       # purge puis tout
 *   node scripts/construire_couverture_rayon.mjs --bandes 60  # plus fin
 *
 * ── LA CIBLE EST LA BASE LOCALE, ET C'EST UN RENVERSEMENT ─────────────────
 *
 * Cet en-tete disait jusqu'au 2026-09-18 : « La cible est celle de `.env.local`
 * (PRODUCTION). C'est voulu : les carreaux ne sont complets qu'en production —
 * la base locale n'en porte que 8,7 %. »
 *
 * La premisse est tombee le jour meme : `scripts/local/07-carreaux-insee.sh`
 * charge les 2 324 577 carreaux depuis le CSV INSEE, et le local en porte
 * desormais PLUS que la prod (les DROM en plus). La regle survivait a son
 * contexte, et elle commandait le mauvais geste — c'est ce pre-calcul, lance
 * contre la production, qui en a epuise le budget d'I/O.
 *
 * Par defaut : `.env.development.local`, donc la base LOCALE. `--prod` vise la
 * production et l'annonce bruyamment ; ce n'est PAS le geste du quotidien.
 */
import { readFileSync, existsSync } from 'node:fs';
import { CONTENEUR, ZONES_LOINTAINES, nb, psql } from './local/psql-conteneur.mjs';
import { createClient } from '@supabase/supabase-js';

const versProd = process.argv.includes('--prod');
const fichierEnv = versProd ? '.env.local' : '.env.development.local';
if (!existsSync(fichierEnv)) {
  console.error(`ERREUR : ${fichierEnv} introuvable.`);
  console.error(versProd
    ? '        (--prod exige .env.local)'
    : '        Monter le stack local, puis scripts/local/04-env-local.sh — ou --prod pour viser la production.');
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(fichierEnv, 'utf8')
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
  console.error(`ERREUR : NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente de ${fichierEnv}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const tout = args.includes('--tout');
const refaire = args.includes('--refaire') || tout;
const iBandes = args.indexOf('--bandes');
/**
 * 120 bandes par defaut, et ce n'est pas un reglage de confort.
 *
 * Le role de PostgREST porte un `statement_timeout` de 2 min, et `set local`
 * A L'INTERIEUR de la fonction ne peut pas prolonger le delai de la requete
 * QUI L'APPELLE — il est deja arme quand la fonction demarre. A 40 bandes, les
 * plus denses tournaient 84 a 99 s et les quelques-unes au-dela etaient
 * annulees, sans jamais pouvoir aboutir.
 *
 * Decouper plus fin ne change pas le travail total, seulement sa taille par
 * transaction. A 120 bandes on vise ~30 s chacune, soit une marge de 4x.
 */
const N = iBandes >= 0 ? Number(args[iBandes + 1]) : 120;

const sb = createClient(url, cle, { auth: { persistSession: false } });

/*
 * ── EN LOCAL, ON NE PASSE PAS PAR POSTGREST ─────────────────────────────────
 *
 * Mesuré le 2026-09-18 : la bande 38 a échoué sur
 * « The upstream server is timing out ». Ce message ne vient PAS de Postgres —
 * c'est Kong, la passerelle HTTP du stack Supabase, qui coupe la requête au
 * bout de 60 s. Desserrer `statement_timeout` côté base n'y change rien : la
 * requête tourne toujours, mais plus personne n'attend sa réponse.
 *
 * Et c'est pire en local qu'en production, ce qui surprend : le rôle
 * `authenticator` y porte `statement_timeout=8s` (contre 2 min en prod), et
 * Kong plafonne à 60 s. Un bac à sable plus strict que la production.
 *
 * Un outil de CONSTRUCTION n'a aucune raison d'emprunter la passerelle de
 * l'application. `psql` dans le conteneur parle à Postgres directement : pas de
 * passerelle, pas de délai imposé de l'extérieur, et une bande dense peut durer
 * ses trois minutes.
 *
 * Le chemin HTTPS reste celui de `--prod`, où `psql` n'est pas une option.
 */

/** Les cinq acces dont ce script a besoin, dans les deux chemins. */
const base = versProd
  ? {
      async purger() {
        const { data, error } = await sb.rpc('vider_couverture_rayon');
        if (error) throw new Error(`purge : ${error.message}`);
        return Number(data ?? 0);
      },
      async premiereBandeMetropole() {
        const { data } = await sb
          .from('couverture_rayon_bandes')
          .select('bande, lon_min, lon_max')
          .lt('bande', 1000)
          .limit(1);
        return data && data.length > 0 ? data[0] : null;
      },
      async bandesFaites() {
        const { data } = await sb.from('couverture_rayon_bandes').select('bande');
        return new Set((data ?? []).map((r) => r.bande));
      },
      async construire(args) {
        const { data, error } = await sb.rpc('construire_couverture_rayon', args);
        if (error) throw new Error(error.message);
        return data ?? {};
      },
      async compter() {
        const { count } = await sb
          .from('couverture_rayon_risque')
          .select('*', { count: 'exact', head: true });
        return Number(count ?? 0);
      },
    }
  : {
      async purger() {
        return Number(psql('select public.vider_couverture_rayon()') || 0);
      },
      async premiereBandeMetropole() {
        // Guillemets doubles côté JS, simples côté SQL : c'est la seule
        // combinaison qui ne demande aucun échappement.
        const l = psql(
          "select lon_min::text || '|' || lon_max::text from public.couverture_rayon_bandes " +
          "where bande < 1000 limit 1",
        );
        if (!l) return null;
        const [lon_min, lon_max] = l.split('|');
        return { lon_min, lon_max };
      },
      async bandesFaites() {
        // La liste est assemblée PAR SQL et séparée par des virgules, plutôt
        // que découpée sur les fins de ligne de psql : un séparateur de ligne
        // demande un antislash dans ce fichier, et Postgres rend des fins de
        // ligne Windows quand il tourne dans un conteneur sous WSL.
        const l = psql("select coalesce(string_agg(bande::text, ','), '') from public.couverture_rayon_bandes");
        return new Set(l ? l.split(',').map((x) => Number(x.trim())) : []);
      },
      async construire(args) {
        // Les arguments sont NOMMES : la fonction en a six, tous a valeur par
        // defaut sauf le premier, et les passer par position se tromperait au
        // premier ajout. Ce sont des nombres, jamais du texte : rien a echapper.
        const nommes = Object.entries(args)
          .map(([k, v]) => `${k} => ${v}`)
          .join(', ');
        return JSON.parse(psql(`select public.construire_couverture_rayon(${nommes})`));
      },
      async compter() {
        return Number(psql('select count(*) from public.couverture_rayon_risque') || 0);
      },
    };

async function principal() {
  console.log(`▶ Construction de couverture_rayon_risque — ${N} bandes`);
  console.log(`  base : ${url}`);
  // Une ligne qui ne peut pas etre confondue : ce script ecrit des millions
  // de lignes et relit les 2,3 M carreaux a chaque bande.
  console.log(versProd ? '  ⚠ CIBLE : PRODUCTION' : '  cible : base LOCALE');

  /*
   * ⚠ CHANGER LE NOMBRE DE BANDES IMPOSE `--tout`.
   *
   * Les bandes partitionnent les carreaux ; un autre découpage recouvre
   * différemment les mêmes carreaux, et l'insertion étant ADDITIVE, reprendre
   * un journal bâti avec un autre `N` doublerait des populations.
   *
   * Le journal ne stocke pas `N`, mais il stocke les bornes de chaque bande :
   * leur largeur le donne. On le déduit plutôt que d'ajouter une colonne — et
   * surtout plutôt que de faire confiance à l'opérateur pour s'en souvenir.
   */
  //
  // ⚠ `.lt('bande', 1000)` : les zones lointaines (ci-dessous) sont journalisées
  // sous des clés >= 1000 et couvrent chacune UNE bande de largeur quelconque.
  // Les lire ici ferait déduire un nombre de bandes absurde et bloquerait toute
  // reprise avec un message d'erreur parfaitement faux.
  const journal = await base.premiereBandeMetropole();
  if (!tout && journal) {
    const largeur = Number(journal.lon_max) - Number(journal.lon_min);
    const nPrecedent = largeur > 0 ? Math.round((9.8 - -5.5) / largeur) : null;
    if (nPrecedent !== null && nPrecedent !== N) {
      console.error(
        `ERREUR : le journal a été construit avec ${nPrecedent} bandes, pas ${N}. ` +
        `Mélanger deux découpages doublerait des populations — relancer avec --tout.`,
      );
      process.exit(1);
    }
  }

  if (tout) {
    console.log(`  purge : ${nb(await base.purger())} lignes effacées`);
  }

  let faites = new Set();
  if (!refaire) {
    faites = await base.bandesFaites();
    if (faites.size > 0) console.log(`  ${faites.size} bande(s) déjà construite(s), sautée(s)`);
  }

  const t0 = Date.now();
  let lignes = 0;
  let traitees = 0;

  for (let b = 0; b < N; b++) {
    if (faites.has(b)) continue;
    const tb = Date.now();
    let r;
    try {
      r = await base.construire({ p_bande: b, p_n_bandes: N });
    } catch (e) {
      // On NE s'arrête PAS : une bande qui échoue n'est PAS journalisée, et le
      // reste continue. Reprendre le script la retentera.
      console.error(`  bande ${b}/${N} — ÉCHEC : ${e.message.split('\n')[0]}`);
      continue;
    }
    lignes += Number(r.lignes ?? 0);
    traitees++;
    const pct = Math.round(((b + 1) / N) * 100);
    console.log(
      `  [${String(pct).padStart(3)} %] bande ${String(b).padStart(2)}/${N} · ` +
      `${String(nb(Number(r.lignes ?? 0))).padStart(6)} lignes · ` +
      `${String(Math.round((Date.now() - tb) / 1000)).padStart(3)} s`,
    );
  }

  /*
   * ── LES ZONES LOINTAINES ────────────────────────────────────────────────
   *
   * Le découpage en bandes ci-dessus va de -5,5 à 9,8 : la bbox métropole de
   * `CLAUDE.md`. Mesuré le 2026-09-18, 1 698 sites ICPE tombent hors de cet
   * intervalle, DONT 45 SEVESO — et ils n'apparaissaient sur aucune courbe
   * sans que rien ne le signale : la courbe montre une population, et une
   * population absente ressemble trait pour trait à une population nulle.
   *
   * Elles ne sont PAS ajoutées au découpage principal. Un partitionnement
   * uniforme de -61,8 à 55,8 mettrait la France entière dans une ou deux
   * bandes de 1° — précisément les bandes trop denses qui dépassaient le délai
   * d'expiration. Chaque zone a donc ses propres bornes et sa propre clé de
   * journal, et tient en UNE bande : elles sont minuscules.
   *
   * Les zones : `ZONES_LOINTAINES` de `local/psql-conteneur.mjs` (Martinique et La Réunion, les seules que le
   * carroyage publie).
   */

  for (const z of ZONES_LOINTAINES) {
    if (faites.has(z.id)) continue;
    const tz = Date.now();
    let r;
    try {
      r = await base.construire({
        p_bande: 0, p_n_bandes: 1,
        p_lon_ouest: z.ouest, p_lon_est: z.est,
        p_bande_id: z.id,
      });
    } catch (e) {
      console.error(`  ${z.nom} — ÉCHEC : ${e.message.split('\n')[0]}`);
      continue;
    }
    lignes += Number(r.lignes ?? 0);
    traitees++;
    console.log(
      `  [zone] ${z.nom.padEnd(12)} · ${String(nb(Number(r.lignes ?? 0))).padStart(6)} lignes · ` +
      `${String(Math.round((Date.now() - tz) / 1000)).padStart(3)} s`,
    );
  }

  const count = await base.compter();

  console.log('');
  console.log(`✓ ${traitees} bande(s) construite(s) en ${Math.round((Date.now() - t0) / 1000)} s`);
  console.log(`  ${nb(lignes)} lignes écrites · ${nb(count)} lignes en table`);
}

principal().catch((e) => {
  console.error('ÉCHEC :', e.message);
  process.exit(1);
});
