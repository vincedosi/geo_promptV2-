/**
 * @file app/api/zones/jeux/[id]/rattacher/route.ts
 *
 * POST — donne un jeu de zones comme PLAN à une campagne.
 *
 * ── CE QUE CETTE ROUTE ÉCRIT, ET OÙ ──────────────────────────────────────
 *
 * Elle ne crée pas un nouveau chemin de plan : elle alimente celui qui existe.
 *
 *     zone_set_cp
 *         │  genererPlanCp (lib/zones/plan.ts) — fonction PURE, testée
 *         ▼
 *     bidding_zone_configs.bid_multiplier
 *         │  refresh_campaign_rollups : planned_share = m / SUM(m)
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
 * pas sous elle. Même raisonnement que `strategie_versions` (sql/157).
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
import { checkCampaignAccess } from '@/lib/campaigns/access';
import { lireCorps } from '@/lib/api/valider-corps';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { normaliserJeu } from '@/lib/zones/jeu';
import { genererPlanCp, type CpZone } from '@/lib/zones/plan';
import { lireTout } from '@/lib/supabase/lire-tout';

export const dynamic = 'force-dynamic';

const limiteur = createRateLimiter({
  max: 6,
  window: '60 s',
  prefix: 'geo:rl:zone-set-rattacher',
});

const CorpsSchema = z.object({
  campagne: z.string().uuid(),
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

  const { data: jeuRow, error: erreurJeu } = await supabase
    .from('zone_sets')
    .select('*')
    .eq('id', id)
    .eq('org_id', profile.organization_id ?? '')
    .maybeSingle();

  if (erreurJeu) {
    console.error('[zones/rattacher] lecture jeu :', erreurJeu.message);
    return NextResponse.json({ error: 'Jeu de zones illisible.' }, { status: 500 });
  }
  if (!jeuRow) {
    return NextResponse.json({ error: 'Jeu de zones introuvable.' }, { status: 404 });
  }
  if (!jeuRow.construit_le) {
    return NextResponse.json(
      { error: 'Ce jeu de zones n’a pas été construit : il n’a aucun code postal à donner.' },
      { status: 409 },
    );
  }

  /*
   * ⚠ Lecture PAGINÉE, et ce n'est pas une précaution. PostgREST applique
   * `db-max-rows = 1000` côté SERVEUR (`supabase/config.toml:18`), et un
   * `.limit(7000)` client ne le lève PAS. Mesuré le 2026-09-20 : un jeu de
   * 1 942 codes postaux en rendait 1 000, et le plan écrit couvrait donc la
   * moitié du jeu — un plan partiel qui se présente comme complet, exactement
   * ce que le rollback de lot plus bas existe pour empêcher.
   *
   * ⚠ À ne pas confondre avec la troncature à 5 000 lignes des RPC
   * `RETURNS TABLE` que `CLAUDE.md` documente : celle-ci frappe les requêtes de
   * table ordinaires, et elle est quatre fois plus basse.
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
        .eq('zone_set_id', id)
        .order('code_postal')
        .range(de, a),
      7000,
    ));
  } catch (e) {
    console.error('[zones/rattacher] lecture CP :', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Codes postaux du jeu illisibles.' }, { status: 500 });
  }

  if (cpRows.length === 0) {
    return NextResponse.json(
      { error: 'Ce jeu de zones ne couvre aucun code postal.' },
      { status: 409 },
    );
  }

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

  const plan = genererPlanCp(cps, jeu);
  const aEcrire = plan.lignes.filter((l) => l.multiplicateur > 0);

  if (aEcrire.length === 0) {
    return NextResponse.json(
      {
        error:
          'Ce jeu ne produit aucun plan : aucun code postal ne franchit le seuil de '
          + 'couverture. Abaissez le seuil, ou élargissez les rayons.',
      },
      { status: 409 },
    );
  }

  /*
   * La stratégie porte le plan. On REMPLACE celle de la campagne plutôt que
   * d'en empiler une : `refresh_campaign_rollups` ne lit que la plus récente
   * (`ORDER BY created_at DESC LIMIT 1`), donc une stratégie de plus laisserait
   * des lignes orphelines qui ne servent rien et brouillent le diagnostic.
   */
  const { data: strat, error: erreurStrat } = await supabase
    .from('bidding_strategies')
    .insert({
      name: `Jeu de zones — ${jeuRow.nom} (v${jeuRow.version})`,
      description:
        `Plan genere depuis le jeu de zones « ${jeuRow.nom} », version ${jeuRow.version}, `
        + `mode ${jeu.mode_plan}, seuil de couverture ${jeu.seuil_couverture_cp} %.`,
      campaign_id: corps.valeur.campagne,
      // ⚠ Ces deux codes sont des CLÉS ÉTRANGÈRES vers des catalogues
      // (`bidding_algorithms`, `bidding_objectives`), pas des chaînes libres.
      // `zone_set` y a été ajouté par sql/212 avec `is_enabled = false` : la
      // ligne existe pour que la clé tienne, le wizard ne la propose pas.
      algorithm_code: 'zone_set',
      // L'objectif n'est PAS ce que le jeu de zones décide — il décide le
      // PLAN. `maximize_impressions` est le neutre du catalogue.
      objective_code: 'maximize_impressions',
      granularity: 'postal_code',
      weighting_mode: 'by_zone_set',
      status: 'active',
      // La SOURCE du plan, lue par le Suivi pour ses libellés : sans elle,
      // l'écran retomberait sur `abstention_pres_2022` et parlerait d'une
      // variable que personne n'a choisie.
      in_zone_weights: {
        mode: 'zone_set',
        zone_set_id: id,
        zone_set_nom: jeuRow.nom,
        zone_set_version: jeuRow.version,
        mode_plan: jeu.mode_plan,
        seuil_couverture_cp: jeu.seuil_couverture_cp,
        taux_utile: plan.taux_utile,
        part_plan_en_zone: plan.part_plan_en_zone,
      },
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

  const { error: erreurRefresh } = await supabase.rpc('refresh_campaign_rollups', {
    p_campaign_id: corps.valeur.campagne,
  });
  if (erreurRefresh) {
    console.error('[zones/rattacher] rollups :', erreurRefresh.message);
    return NextResponse.json(
      { error: 'Plan écrit, mais le rafraîchissement des agrégats a échoué.' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    jeu: id,
    version: jeuRow.version,
    strategie: strat.id,
    codes_postaux: aEcrire.length,
    mode_plan: jeu.mode_plan,
    // Les deux chiffres qui doivent voyager avec le plan, et que l'écran
    // affiche au moment du rattachement.
    part_plan_en_zone: plan.part_plan_en_zone,
    taux_utile: plan.taux_utile,
    n_retenus: plan.n_retenus,
  }, { status: 201 });
}
