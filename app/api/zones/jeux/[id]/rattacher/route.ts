/**
 * @file app/api/zones/jeux/[id]/rattacher/route.ts
 *
 * POST — donne un jeu de zones comme PLAN à une campagne.
 *
 * Corps : `{ campagne: uuid, extraction?: uuid }`. Deux chemins, un seul écrivain (`ecrirePlan`) :
 * - SANS `extraction` (wizard React) : jeu RISQUE seul, plan recalculé depuis l'état VIVANT du jeu — inchangé ;
 * - AVEC `extraction` (étape ⑥ de la carte, lot 6, A-4) : jeu des deux types, plan RECOPIÉ de l'extraction figée,
 *   sans recalcul (`zone_set_extraction_cp.multiplicateur > 0`). Une extraction dont AUCUNE plateforme n'achète au CP
 *   se rattache sans plan CP : stratégie écrite, `codes_postaux: 0`, aucune ligne de `bidding_zone_configs` (T6).
 *
 * ── CE QUE CETTE ROUTE ÉCRIT, ET OÙ ──────────────────────────────────────
 *
 * Elle ne crée pas un nouveau chemin de plan : elle alimente celui qui existe.
 *
 *     zone_set_cp                         zone_set_extraction_cp
 *         │  genererPlanCp (lib/zones/plan.ts)    │  recopié tel quel
 *         ▼                                       ▼
 *     bidding_zone_configs.bid_multiplier (+ part_prevue, A8)
 *         │  refresh_campaign_rollups : planned_share = part_prevue si le plan en porte (jeu de zone, sql/306),
 *         │                             m / SUM(m) sinon (chemin risque, inchangé)
 *         ▼
 *     campaign_cp_rollup.planned_share
 *
 * C'est la seule source de plan du produit (audit § 1.1). En emprunter une
 * autre obligerait à réécrire le score d'alignement, le suivi, les constats et
 * l'export — pour le même résultat.
 *
 * ── LA VERSION EST FIGÉE ─────────────────────────────────────────────────
 *
 * Le numéro de version du jeu est recopié dans la stratégie. Un jeu modifié
 * ensuite crée une NOUVELLE version : le plan d'une campagne en vol ne change
 * pas sous elle. Même raisonnement que `strategie_versions` (sql/157). Une
 * extraction est figée par construction : son identifiant et son numéro
 * suivent dans `in_zone_weights`.
 *
 * ── LES LOTS DE 50 ───────────────────────────────────────────────────────
 *
 * `CLAUDE.md` impose des lots de 50 sur tout insert batch. Ici ce n'est pas
 * qu'une règle : un plan national fait ~6 000 codes postaux, et un seul insert
 * de 6 000 lignes échouerait en bloc sans dire laquelle est fautive.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { chargerJeu } from '@/lib/zones/charger-jeu';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import { lireCorps } from '@/lib/api/valider-corps';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { normaliserJeu } from '@/lib/zones/jeu';
import { genererPlanCp, type CpZone } from '@/lib/zones/plan';
import { lireGroupesCp } from '@/lib/zones/groupes';
import { lireTout } from '@/lib/supabase/lire-tout';
import { toJson } from '@/lib/supabase/rpc-json';
import {
  MESSAGE_AUCUN_CP, PLAFOND_CP_PLAN, planExtraction, refusPlan, type ClientAdmin, type IssuePlan, type Plan,
} from '@/lib/zones/plan-extraction';
import type { Tables } from '@/types/database.types';

export const dynamic = 'force-dynamic';

const limiteur = createRateLimiter({
  max: 6,
  window: '60 s',
  prefix: 'geo:rl:zone-set-rattacher',
});

const CorpsSchema = z.object({
  campagne: z.string().uuid(),
  extraction: z.string().uuid().optional(),
});

/** Taille de lot imposée par `CLAUDE.md`. */
const LOT = 50;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Identifiant de jeu invalide.' }, { status: 400 });
  }

  const corps = await lireCorps(request, CorpsSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });

  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const supabase = createAdminClient();

  const acces = await checkCampaignAccess(supabase, profile, corps.valeur.campagne);
  if (acces === 'not_found') {
    return NextResponse.json({ error: 'Campagne introuvable.' }, { status: 404 });
  }
  if (acces !== 'ok') {
    return NextResponse.json({ error: 'Accès refusé à cette campagne.' }, { status: 403 });
  }

  // L'espace est vérifié par le chargeur, et non par RLS (`createAdminClient()` contourne toute policy). Sans
  // extraction, un jeu de zone (étape ⑤) n'a rien de vivant à donner : 409 du chargeur, comme avant le lot 6.
  const { extraction } = corps.valeur;
  const charge = await chargerJeu(supabase, id, profile.organization_id ?? '', extraction ? {} : { type: 'risque' });
  if (!charge.ok) return charge.reponse;

  const plan = extraction
    ? await planExtraction(supabase, charge.jeu, extraction)
    : await planVivant(supabase, charge.jeu);
  if ('reponse' in plan) return plan.reponse;
  return ecrirePlan(supabase, corps.valeur.campagne, charge.jeu, plan);
}

/** Le chemin VIVANT d'un jeu risque : `zone_set_cp` relu, puis `genererPlanCp`. Inchangé depuis le lot 5. */
async function planVivant(supabase: ClientAdmin, jeuRow: Tables<'zone_sets'>): Promise<IssuePlan> {
  if (!jeuRow.construit_le) {
    return refusPlan('Ce jeu de zones n’a pas été construit : il n’a aucun code postal à donner.', 409);
  }

  /*
   * ⚠ Lecture PAGINÉE, et ce n'est pas une précaution. PostgREST applique
   * `db-max-rows = 1000` côté SERVEUR (`supabase/config.toml:18`), et un
   * `.limit(7000)` client ne le lève PAS. Mesuré le 2026-09-20 : un jeu de
   * 1 942 codes postaux en rendait 1 000, et le plan écrit couvrait donc la
   * moitié du jeu — un plan partiel qui se présente comme complet, exactement
   * ce que le rollback de lot plus bas existe pour empêcher.
   *
   * C'est le MÊME plafond qui frappe les RPC `RETURNS TABLE` (CLAUDE.md
   * § Troncature PostgREST). Ce commentaire disait jusqu'au 2026-10-10 qu'il
   * s'agissait d'un autre plafond, « quatre fois plus bas » qu'un « 5 000 des
   * RPC » — le réglage de l'ancien projet hébergé.
   */
  let cpRows: Array<{
    code_postal: string; classe: string; pop_en_zone: number;
    pop_totale: number; retenu: boolean;
  }>;
  try {
    ({ lignes: cpRows } = await lireTout(
      (de, a) => supabase
        .from('zone_set_cp')
        .select('code_postal, classe, pop_en_zone, pop_totale, retenu')
        .eq('zone_set_id', jeuRow.id)
        .order('code_postal')
        .range(de, a),
      PLAFOND_CP_PLAN,
    ));
  } catch (e) {
    console.error('[zones/rattacher] lecture CP :', e instanceof Error ? e.message : e);
    return refusPlan('Codes postaux du jeu illisibles.', 500);
  }

  if (cpRows.length === 0) return refusPlan(MESSAGE_AUCUN_CP, 409);

  const jeu = normaliserJeu({
    profil: jeuRow.profil,
    cible: jeuRow.cible,
    gravites: jeuRow.gravites,
    natures: jeuRow.natures,
    modes: jeuRow.modes,
    territoire: jeuRow.territoire,
    mode_plan: jeuRow.mode_plan,
    seuil_couverture_cp: Number(jeuRow.seuil_couverture_cp),
    poids: jeuRow.poids,
  });

  const cps: CpZone[] = cpRows.map((r) => ({
    code_postal: r.code_postal,
    classe: r.classe,
    pop_en_zone: Number(r.pop_en_zone),
    pop_totale: Number(r.pop_totale),
    retenu: r.retenu,
  }));

  // Les codes postaux que le référentiel ne distingue pas : le plan les
  // achète TOUS, sans quoi on cible un quart d'une ville (lib/zones/groupes.ts).
  const groupes = await lireGroupesCp(supabase);
  const plan = genererPlanCp(cps, jeu, groupes);
  const lignes = plan.lignes.filter((l) => l.multiplicateur > 0);

  if (lignes.length === 0) {
    return refusPlan(
      'Ce jeu ne produit aucun plan : aucun code postal ne franchit le seuil de '
      + 'couverture. Abaissez le seuil, ou élargissez les rayons.',
      409,
    );
  }

  return {
    lignes,
    nom: `Jeu de zones — ${jeuRow.nom} (v${jeuRow.version})`,
    description:
      `Plan genere depuis le jeu de zones « ${jeuRow.nom} », version ${jeuRow.version}, `
      + `mode ${jeu.mode_plan}, seuil de couverture ${jeu.seuil_couverture_cp} %.`,
    source: {
      mode: 'zone_set',
      zone_set_id: jeuRow.id,
      zone_set_nom: jeuRow.nom,
      zone_set_version: jeuRow.version,
      mode_plan: jeu.mode_plan,
      seuil_couverture_cp: jeu.seuil_couverture_cp,
      taux_utile: plan.taux_utile,
      part_plan_en_zone: plan.part_plan_en_zone,
    },
    // Les deux chiffres qui doivent voyager avec le plan, et que l'écran
    // affiche au moment du rattachement.
    resume: {
      mode_plan: jeu.mode_plan,
      part_plan_en_zone: plan.part_plan_en_zone,
      taux_utile: plan.taux_utile,
      n_retenus: plan.n_retenus,
    },
  };
}

/**
 * Écrit le plan d'un des deux chemins : stratégie, lignes par lots de 50 (rollback si un lot échoue), archivage des
 * stratégies précédentes APRÈS, puis `refresh_campaign_rollups`. Rend la réponse finale.
 */
async function ecrirePlan(
  supabase: ClientAdmin, campagne: string, jeuRow: Tables<'zone_sets'>, plan: Plan,
): Promise<NextResponse> {
  /*
   * La stratégie porte le plan. `refresh_campaign_rollups` ne lit que la PLUS
   * RÉCENTE (`ORDER BY created_at DESC LIMIT 1`), donc celle qu'on insère ici
   * devient le plan de la campagne dès qu'elle existe.
   *
   * ⚠ Les précédentes sont ARCHIVÉES juste après, et non avant. Les archiver
   * d'abord laisserait la campagne sans plan actif si l'écriture échouait
   * ensuite ; les laisser en `active` ferait afficher deux stratégies actives
   * pour une seule campagne, et l'écran ne saurait pas laquelle nommer.
   *
   * Archivées et NON supprimées : une stratégie porte l'historique de ce qui a
   * été poussé au DSP (`strategie_versions`, `activation_lots`). L'effacer
   * rendrait un rollback aveugle.
   */
  const { data: strat, error: erreurStrat } = await supabase
    .from('bidding_strategies')
    .insert({
      name: plan.nom,
      description: plan.description,
      campaign_id: campagne,
      // ⚠ Ces deux codes sont des CLÉS ÉTRANGÈRES vers des catalogues
      // (`bidding_algorithms`, `bidding_objectives`), pas des chaînes libres.
      // `zone_set` y a été ajouté par sql/212 avec `is_enabled = false` : la
      // ligne existe pour que la clé tienne, le wizard ne la propose pas.
      algorithm_code: 'zone_set',
      // L'objectif n'est PAS ce que le jeu de zones décide — il décide le
      // PLAN. `maximize_impressions` est le neutre du catalogue, et c'est lui
      // qui fait lire `kpi_target` comme volume prévu (`get_campaign_expected`).
      objective_code: 'maximize_impressions',
      granularity: 'postal_code',
      weighting_mode: 'by_zone_set',
      status: 'active',
      // La SOURCE du plan, lue par le Suivi pour ses libellés : sans elle,
      // l'écran retomberait sur `abstention_pres_2022` et parlerait d'une
      // variable que personne n'a choisie.
      in_zone_weights: toJson(plan.source),
    })
    .select('id')
    .single();

  if (erreurStrat || !strat) {
    console.error('[zones/rattacher] strategie :', erreurStrat?.message);
    return NextResponse.json({ error: 'Rattachement impossible.' }, { status: 500 });
  }

  /*
   * Lots de 50. ⚠ Un échec de lot n'est PAS ignoré : supabase-js ne lève pas,
   * il rend `{ error }`. Sans cette lecture, un plan à moitié écrit passerait
   * pour complet — et la campagne diffuserait sur la moitié de son plan sans
   * que rien ne le signale.
   */
  for (let i = 0; i < plan.lignes.length; i += LOT) {
    const lot = plan.lignes.slice(i, i + LOT).map((l) => ({
      strategy_id: strat.id,
      postal_code: l.code_postal,
      country_code: 'FR',
      bid_multiplier: l.multiplicateur,
      weight: l.multiplicateur,
      // A8 : la part prévue E5 figée à l'extraction ; `null` sur le chemin risque (le suivi garde m ÷ Σ m).
      part_prevue: l.part_prevue ?? null,
      is_active: true,
      target_metrics: { classe: l.classe, retenu: l.retenu },
    }));
    const { error } = await supabase.from('bidding_zone_configs').insert(lot);
    if (error) {
      console.error(`[zones/rattacher] lot ${i / LOT} :`, error.message);
      /*
       * La stratégie est retirée : un plan partiel est pire qu'aucun plan,
       * parce qu'il se présente comme complet.
       *
       * ⚠ L'erreur de la suppression est LUE. `supabase-js` ne lève pas : un
       * rollback raté laisserait une stratégie à demi peuplée que
       * `refresh_campaign_rollups` prendrait pour le plan courant — la
       * campagne diffuserait alors sur la moitié de son plan sans que rien ne
       * le signale.
       */
      const { error: erreurRollback } = await supabase
        .from('bidding_strategies').delete().eq('id', strat.id);
      const suffixe = erreurRollback
        ? ' Le plan partiel n’a PAS pu être retiré : détachez le jeu avant de réessayer.'
        : '';
      if (erreurRollback) {
        console.error('[zones/rattacher] rollback :', erreurRollback.message);
      }
      return NextResponse.json(
        {
          error: `Écriture du plan interrompue au code postal ${lot[0]?.postal_code}.${suffixe}`,
        },
        { status: 500 },
      );
    }
  }

  /*
   * Les stratégies précédentes passent en `archived`. L'erreur est LUE :
   * supabase-js ne lève pas, et deux stratégies `active` sur une campagne
   * feraient diverger ce que l'écran nomme de ce que les rollups calculent.
   * Ce n'est pas bloquant pour autant — le plan est déjà écrit et correct.
   */
  const { error: erreurArchive } = await supabase
    .from('bidding_strategies')
    .update({ status: 'archived' })
    .eq('campaign_id', campagne)
    .neq('id', strat.id)
    .in('status', ['draft', 'active', 'paused']);
  if (erreurArchive) {
    console.error('[zones/rattacher] archivage des strategies precedentes :', erreurArchive.message);
  }

  const { error: erreurRefresh } = await supabase.rpc('refresh_campaign_rollups', {
    p_campaign_id: campagne,
  });
  if (erreurRefresh) {
    console.error('[zones/rattacher] rollups :', erreurRefresh.message);
    return NextResponse.json(
      { error: 'Plan écrit, mais le rafraîchissement des agrégats a échoué.' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    jeu: jeuRow.id,
    version: jeuRow.version,
    strategie: strat.id,
    codes_postaux: plan.lignes.length,
    ...plan.resume,
    // L'écran doit pouvoir dire que l'archivage a échoué : la campagne
    // diffuserait bien sur le bon plan, mais afficherait deux stratégies.
    anciennes_archivees: !erreurArchive,
  }, { status: 201 });
}
