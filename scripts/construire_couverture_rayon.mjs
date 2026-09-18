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
 * La cible est celle de `.env.local` (PRODUCTION). C'est voulu : les carreaux
 * ne sont complets qu'en production — la base locale n'en porte que 8,7 %.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

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

const nb = (n) => new Intl.NumberFormat('fr-FR').format(n);

async function principal() {
  console.log(`▶ Construction de couverture_rayon_risque — ${N} bandes`);
  console.log(`  base : ${url}`);

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
  const { data: journal } = await sb
    .from('couverture_rayon_bandes')
    .select('bande, lon_min, lon_max')
    .limit(1);
  if (!tout && journal && journal.length > 0) {
    const largeur = Number(journal[0].lon_max) - Number(journal[0].lon_min);
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
    const { data, error } = await sb.rpc('vider_couverture_rayon');
    if (error) throw new Error(`purge : ${error.message}`);
    console.log(`  purge : ${nb(data ?? 0)} lignes effacées`);
  }

  let faites = new Set();
  if (!refaire) {
    const { data } = await sb.from('couverture_rayon_bandes').select('bande');
    faites = new Set((data ?? []).map((r) => r.bande));
    if (faites.size > 0) console.log(`  ${faites.size} bande(s) déjà construite(s), sautée(s)`);
  }

  const t0 = Date.now();
  let lignes = 0;
  let traitees = 0;

  for (let b = 0; b < N; b++) {
    if (faites.has(b)) continue;
    const tb = Date.now();
    const { data, error } = await sb.rpc('construire_couverture_rayon', {
      p_bande: b, p_n_bandes: N,
    });
    if (error) {
      // On NE s'arrête PAS : une bande qui échoue est journalisée et le reste
      // continue. Reprendre le script la retentera, puisqu'elle n'est pas au
      // journal.
      console.error(`  bande ${b}/${N} — ÉCHEC : ${error.message}`);
      continue;
    }
    const r = data ?? {};
    lignes += Number(r.lignes ?? 0);
    traitees++;
    const pct = Math.round(((b + 1) / N) * 100);
    console.log(
      `  [${String(pct).padStart(3)} %] bande ${String(b).padStart(2)}/${N} · ` +
      `${String(nb(Number(r.lignes ?? 0))).padStart(6)} lignes · ` +
      `${String(Math.round((Date.now() - tb) / 1000)).padStart(3)} s`,
    );
  }

  const { count } = await sb
    .from('couverture_rayon_risque')
    .select('*', { count: 'exact', head: true });

  console.log('');
  console.log(`✓ ${traitees} bande(s) construite(s) en ${Math.round((Date.now() - t0) / 1000)} s`);
  console.log(`  ${nb(lignes)} lignes écrites · ${nb(count ?? 0)} lignes en table`);
}

principal().catch((e) => {
  console.error('ÉCHEC :', e.message);
  process.exit(1);
});
