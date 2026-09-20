#!/usr/bin/env node
/**
 * Le jeu de démonstration du module risque : un jeu de zones, une campagne
 * rattachée, et des impressions qui racontent quelque chose.
 *
 * ── CE QU'IL CORRIGE ──────────────────────────────────────────────────────
 *
 * La version du 2026-09-19 produisait quatre défauts, tous constatés à l'essai :
 *
 *   · 1 196 332 538 impressions en 30 jours — irréaliste d'un facteur trente ;
 *   · dv360 7,06 €, regie_locale 7,06 €, tiktok 7,07 € — indiscernables ;
 *   · aucun plan, donc un alignement de 100/100 qui ne mesurait rien ;
 *   · « La dernière actualisation a échoué », qui n'était pas un échec.
 *
 * Les deux premiers venaient du générateur, les deux autres de l'absence d'un
 * objet « jeu de zones ». Ce script crée donc le jeu AVANT la campagne.
 *
 * ── L'ORDRE EST LA CORRECTION ─────────────────────────────────────────────
 *
 *   1. jeu de zones, et sa construction (géométries + codes postaux) ;
 *   2. campagne, rattachée à ce jeu ;
 *   3. plan écrit dans `bidding_zone_configs`, par lots de 50 ;
 *   4. impressions semées SUR CE PLAN ;
 *   5. rollups rafraîchis.
 *
 * Inverser 1 et 2 — ce que faisait l'ancienne version — donne une campagne qui
 * diffuse sans plan : tout ce qui compare la diffusion au plan s'effondre
 * ensuite en silence.
 *
 * ── UNE SEULE IMPLÉMENTATION DU PLAN ──────────────────────────────────────
 *
 * Le plan passe par `genererPlanCp` (`lib/zones/plan.ts`), la MÊME fonction
 * pure que `/api/zones/jeux/[id]/rattacher`. Le recopier en SQL en donnerait
 * deux versions, et la démonstration finirait par ne plus ressembler à ce que
 * le produit fait.
 *
 * ── REPRODUCTIBLE ─────────────────────────────────────────────────────────
 *
 * Le bruit vient de `md5(code_postal || jour || acteur)`, jamais de
 * `random()`. Deux exécutions donnent exactement le même jeu : une capture
 * d'écran reste valable, et une régression se voit.
 *
 * Usage :
 *   npx tsx scripts/seed-demo-campagne-risque.ts           # crée ou remplace
 *   npx tsx scripts/seed-demo-campagne-risque.ts --purger  # retire tout
 *
 * ⚠ CIBLE : la base LOCALE. Il n'y a plus de production à viser.
 */
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import dotenv from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { JEU_DEFAUT, normaliserJeu, codeJeu } from '@/lib/zones/jeu';
import { genererPlanCp, type CpZone } from '@/lib/zones/plan';
import { lireTout } from '@/lib/supabase/lire-tout';

// Priorité au local. `dotenv` n'écrase jamais une variable déjà posée :
// l'ordre de ces deux lignes EST le garde-fou (CLAUDE.md).
if (existsSync('.env.development.local')) dotenv.config({ path: '.env.development.local' });
dotenv.config({ path: '.env.local' });

/** Identifiants FIXES : rejouer le seed retrouve les mêmes objets. */
const CAMPAGNE = 'd0000000-0000-4000-8000-00000000f1a5';
const NOM_JEU = '[DEMO] Zones Seveso 1 / 2 / 5 km';

/** Impressions visées sur 30 jours. Le brief demande 20 à 40 millions. */
const TOTAL_IMPRESSIONS = 30_000_000;
const JOURS = 30;

/** Taille de lot imposée par `CLAUDE.md`. */
const LOT = 50;

const nb = (n: number) => new Intl.NumberFormat('fr-FR').format(n);

const CONTENEUR = process.env.CONTENEUR_PG ?? 'supabase_db_genesis_app';

/**
 * Parle à Postgres SANS passer par Kong.
 *
 * Réservé aux traitements longs : la passerelle du stack local coupe à 60 s, et
 * la requête continue de tourner après — un échec apparent qui n'en est pas un.
 */
function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', CONTENEUR, 'psql', '-U', 'postgres', '-d', 'postgres',
     '-v', 'ON_ERROR_STOP=1', '-tAc', sql],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

function client(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !cle) {
    console.error('ERREUR : NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente.');
    console.error('        Monter le stack local, puis scripts/local/04-env-local.sh');
    process.exit(1);
  }
  return createClient(url, cle, { auth: { persistSession: false } });
}

/** Lit l'erreur de chaque appel : supabase-js ne lève pas, il rend `{ error }`. */
function ouEchouer<T>(r: { data: T | null; error: { message: string } | null }, quoi: string): T {
  if (r.error) {
    console.error(`\nÉCHEC — ${quoi} : ${r.error.message}`);
    process.exit(1);
  }
  if (r.data === null) {
    console.error(`\nÉCHEC — ${quoi} : aucune donnée rendue.`);
    process.exit(1);
  }
  return r.data;
}

async function purger(sb: SupabaseClient): Promise<void> {
  const r = await sb.rpc('purger_demo_risque');
  const d = ouEchouer(r, 'purge') as { lignes_supprimees: number; jeux_supprimes: number };
  console.log(
    `Jeu de démonstration retiré : ${nb(d.lignes_supprimees)} ligne(s), `
    + `${d.jeux_supprimes} jeu(x) de zones.`,
  );
}

async function main(): Promise<void> {
  const sb = client();

  if (process.argv.includes('--purger')) {
    await purger(sb);
    return;
  }

  // Les deux pré-calculs dont tout dépend. Les vérifier ici évite un échec
  // vingt secondes plus tard, au milieu d'une construction.
  for (const [table, remede] of [
    ['carreau_risque_distance', 'node scripts/construire_carreau_risque.mjs'],
    ['cp_population_totale', 'select public.remplir_cp_population_totale(b, 60) par bande'],
  ] as const) {
    const { count } = await sb.from(table).select('*', { count: 'exact', head: true });
    if (!count) {
      console.error(`ERREUR : ${table} est vide.`);
      console.error(`        ${remede}`);
      process.exit(1);
    }
  }

  // Idempotence : on repart d'une table rase plutôt que d'empiler des versions.
  await purger(sb);

  const org = ouEchouer(
    await sb.from('organizations').select('id').order('created_at').limit(1).single(),
    'organisation',
  ) as { id: string };

  // ── 1. Le jeu de zones ──────────────────────────────────────────────────
  const jeu = normaliserJeu(JEU_DEFAUT);
  process.stdout.write('jeu de zones… ');
  const cree = ouEchouer(
    await sb.from('zone_sets').insert({
      nom: NOM_JEU,
      description:
        'Jeu de demonstration : anneaux 1 / 2 / 5 km au seuil haut, 0,5 / 1 km au seuil bas, '
        + 'perimetres PPRT a part. Seuil de couverture 20 %.',
      org_id: org.id,
      version: 1,
      profil: jeu.profil,
      cible: jeu.cible,
      gravites: jeu.gravites,
      natures: jeu.natures,
      modes: jeu.modes,
      territoire: jeu.territoire,
      mode_plan: jeu.mode_plan,
      seuil_couverture_cp: jeu.seuil_couverture_cp,
      poids: jeu.poids,
      profil_hash: codeJeu(jeu),
    }).select('id').single(),
    'creation du jeu',
  ) as { id: string };

  const construit = ouEchouer(
    await sb.rpc('construire_zone_set', { p_zone_set_id: cree.id }),
    'construction du jeu',
  ) as { ok: boolean; classes: number; codes_postaux: number; retenus: number;
         taux_utile: number | null; duree_ms: number };

  if (!construit.ok) {
    console.error(`\nÉCHEC — construction : ${JSON.stringify(construit)}`);
    process.exit(1);
  }
  console.log(
    `${construit.classes} classes, ${nb(construit.codes_postaux)} codes postaux, `
    + `${nb(construit.retenus)} retenus, taux d’utile ${construit.taux_utile} % `
    + `(${(construit.duree_ms / 1000).toFixed(1)} s)`,
  );

  // ── 2. La campagne ──────────────────────────────────────────────────────
  const fin = new Date();
  fin.setDate(fin.getDate() - 1);
  const debut = new Date(fin);
  debut.setDate(debut.getDate() - JOURS + 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  ouEchouer(
    await sb.from('dsp_campaigns').insert({
      id: CAMPAGNE,
      name: '[DEMO] Risque industriel',
      dsp_source: 'magelian',
      advertiser: 'Annonceur de démonstration',
      product: 'Campagne de sensibilisation',
      date_start: iso(debut),
      date_end: iso(fin),
      countries: ['FR'],
      organization_id: org.id,
      total_budget: 210000,
      currency: 'EUR',
      // Le badge « Données de démonstration » vient de CE drapeau, jamais du
      // préfixe du nom : un nom se modifie à la main, `is_demo` non.
      is_demo: true,
    }).select('id').single(),
    'creation de la campagne',
  );

  // ── 3. Le plan ──────────────────────────────────────────────────────────
  process.stdout.write('plan… ');
  /*
   * ⚠ Lecture PAGINÉE. PostgREST applique `db-max-rows = 1000` côté serveur
   * (`supabase/config.toml:18`), et `.limit(7000)` ne le lève PAS : mesuré le
   * 2026-09-20, `zone_set_cp` portait 1 942 codes postaux et la requête en
   * rendait 1 000. Le plan écrit couvrait donc la moitié du jeu, et le script
   * annonçait « 1 000 codes postaux » sans que rien ne signale l'amputation.
   */
  const { lignes: cpRows } = await lireTout<{
    code_postal: string; classe: string; pop_en_zone: number;
    pop_totale: number; retenu: boolean;
  }>(
    (de, a) => sb.from('zone_set_cp')
      .select('code_postal, classe, pop_en_zone, pop_totale, retenu')
      .eq('zone_set_id', cree.id)
      .order('code_postal')
      .range(de, a),
    7000,
  );

  const cps: CpZone[] = cpRows.map((r) => ({
    code_postal: r.code_postal,
    classe: r.classe,
    pop_en_zone: Number(r.pop_en_zone),
    pop_totale: Number(r.pop_totale),
    retenu: r.retenu,
  }));

  const plan = genererPlanCp(cps, jeu);
  const aEcrire = plan.lignes.filter((l) => l.multiplicateur > 0);

  const strat = ouEchouer(
    await sb.from('bidding_strategies').insert({
      name: `Jeu de zones — ${NOM_JEU} (v1)`,
      description: `Plan de demonstration, mode ${jeu.mode_plan}, seuil ${jeu.seuil_couverture_cp} %.`,
      campaign_id: CAMPAGNE,
      // Clés étrangères vers des catalogues, pas des chaînes libres (sql/212).
      algorithm_code: 'zone_set',
      objective_code: 'maximize_impressions',
      granularity: 'postal_code',
      weighting_mode: 'by_zone_set',
      status: 'active',
      is_demo: true,
      in_zone_weights: {
        mode: 'zone_set',
        zone_set_id: cree.id,
        zone_set_nom: NOM_JEU,
        zone_set_version: 1,
        mode_plan: jeu.mode_plan,
        seuil_couverture_cp: jeu.seuil_couverture_cp,
        taux_utile: plan.taux_utile,
        part_plan_en_zone: plan.part_plan_en_zone,
      },
    }).select('id').single(),
    'creation de la strategie',
  ) as { id: string };

  for (let i = 0; i < aEcrire.length; i += LOT) {
    const lot = aEcrire.slice(i, i + LOT).map((l) => ({
      strategy_id: strat.id,
      postal_code: l.code_postal,
      country_code: 'FR',
      bid_multiplier: l.multiplicateur,
      weight: l.multiplicateur,
      is_active: true,
      target_metrics: { classe: l.classe, retenu: l.retenu },
    }));
    const { error } = await sb.from('bidding_zone_configs').insert(lot);
    if (error) {
      console.error(`\nÉCHEC — lot ${i / LOT} : ${error.message}`);
      process.exit(1);
    }
  }
  console.log(
    `${nb(aEcrire.length)} codes postaux, ${plan.part_plan_en_zone} % du plan en zone`,
  );

  /*
   * ── 4. Les impressions, par `psql` et NON par PostgREST ─────────────────
   *
   * ⚠ Kong, la passerelle HTTP du stack local, coupe à 60 s. Le semis en prend
   * ~74 (174 780 lignes : 1 942 codes postaux × 30 jours × 3 partenaires), et
   * le message « The upstream server is timing out » ne vient PAS de Postgres.
   *
   * Pire : la requête CONTINUE et COMMIT après que Kong a raccroché. Mesuré le
   * 2026-09-20 — l'appel abandonné avait bel et bien écrit ses 174 780 lignes,
   * et un second essai lancé entre-temps est entré en conflit de clé unique
   * avec lui. Un échec apparent qui n'en est pas un est pire qu'un échec.
   *
   * Un outil de CONSTRUCTION n'a aucune raison d'emprunter la passerelle de
   * l'application : `psql` parle à Postgres directement. Même raisonnement et
   * même remède que `scripts/construire_carreau_risque.mjs`.
   */
  process.stdout.write('impressions… ');
  const sem = JSON.parse(psql(
    `select public.seed_impressions_risque_demo('${CAMPAGNE}'::uuid, `
    + `${TOTAL_IMPRESSIONS}, ${JOURS})`,
  )) as { ok: boolean; lignes: number; impressions: number; duree_ms: number };

  if (!sem.ok) {
    console.error(`\nÉCHEC — semis : ${JSON.stringify(sem)}`);
    process.exit(1);
  }
  console.log(
    `${nb(sem.lignes)} lignes, ${nb(sem.impressions)} impressions `
    + `(${(sem.duree_ms / 1000).toFixed(1)} s)`,
  );

  // ── 5. On RELIT ce qui a été écrit ──────────────────────────────────────
  // Plutôt que d'afficher ce qu'on croit avoir écrit : c'est exactement ce
  // qu'un seed doit prouver, et c'est ce qui manquait à la version précédente.
  const align = ouEchouer(
    await sb.rpc('calculer_alignement_geo', {
      p_campaign_id: CAMPAGNE, p_tolerance: null, p_poids: null,
    }),
    'verification de l alignement',
  ) as { calculable: boolean; error?: string; score?: number; conformes_pct?: number;
         plan_couverture_pct?: number };

  console.log('');
  if (!align.calculable) {
    console.error(`⚠ L’alignement n’est PAS calculable : ${align.error}.`);
    console.error('  Le jeu de démonstration ne démontre donc rien. Vérifier le plan.');
    process.exit(1);
  }
  console.log(
    `Alignement ${align.score}/100 · ${align.conformes_pct} % de codes postaux conformes · `
    + `plan sur ${align.plan_couverture_pct} % des codes postaux touchés`,
  );

  const { data: acteurs } = await sb
    .from('campaign_daily_rollup')
    .select('media, impressions, spend')
    .eq('campaign_id', CAMPAGNE);

  if (acteurs && acteurs.length > 0) {
    const parActeur = new Map<string, { imp: number; eur: number }>();
    for (const r of acteurs as Array<{ media: string; impressions: number; spend: number }>) {
      const a = parActeur.get(r.media) ?? { imp: 0, eur: 0 };
      a.imp += Number(r.impressions);
      a.eur += Number(r.spend);
      parActeur.set(r.media, a);
    }
    console.log('\nCPM par partenaire — ils doivent être DISTINCTS :');
    for (const [nom, a] of parActeur) {
      console.log(`  ${nom.padEnd(14)} ${nb(a.imp).padStart(12)} imp · `
        + `${(a.eur / a.imp * 1000).toFixed(2)} €`);
    }
  }

  console.log('\nLe jeu porte is_demo = true : l’écran affiche « Données de démonstration ».');
  console.log('Retrait : npx tsx scripts/seed-demo-campagne-risque.ts --purger');
}

main().catch((e) => {
  console.error(`\nÉCHEC inattendu : ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
