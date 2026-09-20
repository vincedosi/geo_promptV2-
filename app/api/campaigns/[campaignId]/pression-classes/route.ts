/**
 * @file app/api/campaigns/[campaignId]/pression-classes/route.ts
 *
 * GET — la pression réelle de la campagne, classe de zone par classe de zone.
 *
 * ── LA QUESTION ──────────────────────────────────────────────────────────
 *
 * « La campagne presse-t-elle plus, ou moins, les abords des sites classés
 * que son plan ne le prévoyait ? »
 *
 * L'indice est la part des impressions rapportée à la part du PLAN, ×100.
 * 100 = la classe reçoit exactement ce que le plan lui destinait.
 *
 * ── LE DÉNOMINATEUR EST LE PLAN, ET NON LA POPULATION ────────────────────
 *
 * L'onglet « Diffusion » supprimé le même jour comparait à la population,
 * faute de plan. C'était la seule réponse possible alors, mais elle mélange
 * deux questions : « cette zone est-elle sur-pressée au regard de son poids
 * démographique ? » et « la campagne tient-elle son plan ? ». Seule la
 * seconde est actionnable — on ne corrige pas une démographie, on corrige une
 * enchère.
 *
 * ── AUCUNE VENTILATION ───────────────────────────────────────────────────
 *
 * `campaign_cp_rollup` et `zone_set_cp` sont au MÊME grain, le code postal.
 * Pas de prorata, pas d'hypothèse de répartition intra-code-postal. C'est ce
 * qui rend ce bloc plus juste que ce qu'il remplace, et pas seulement moins
 * cher. Mesure : 14 ms sur la campagne de démonstration.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import { rpcJson } from '@/lib/supabase/rpc-json';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { sourceDuPlan } from '@/lib/campagne/source-plan';

export const dynamic = 'force-dynamic';

/**
 * Quota PARTAGÉ avec les cinq routes `alignement/*` : ce bloc est une section
 * du même écran, et lui donner son propre compteur reviendrait à élargir le
 * plafond sans le dire.
 */
const limiteur = createRateLimiter({ max: 60, window: '60 s', prefix: 'geo:rl:alignement' });

/** Ce que la RPC rend. `error` porte les cas métier, jamais un code SQL. */
interface Payload {
  calculable: boolean;
  error?: string;
  impressions_totales?: number;
  part_hors_zone_pct?: number;
  classes?: unknown[];
}

const MESSAGES: Record<string, string> = {
  aucune_donnee:
    'Cette campagne n’a encore aucune impression : il n’y a pas de pression à mesurer.',
  jeu_introuvable:
    'Le jeu de zones de cette campagne a été supprimé. Rattachez-en un autre depuis '
    + 'l’onglet Stratégie.',
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { campaignId } = await params;
  const supabase = createAdminClient();

  const acces = await checkCampaignAccess(supabase, profile, campaignId);
  if (acces !== 'ok') {
    return NextResponse.json({ error: 'Campagne introuvable.' }, { status: 404 });
  }

  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  /*
   * La stratégie la PLUS RÉCENTE, et elle seule : c'est celle que
   * `refresh_campaign_rollups` a utilisée pour écrire `planned_share`. En lire
   * une autre comparerait les impressions d'un plan aux classes d'un autre.
   */
  const { data: strategie, error: erreurStrategie } = await supabase
    .from('bidding_strategies')
    .select('in_zone_weights')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (erreurStrategie) {
    console.error('[pression-classes] strategie :', erreurStrategie.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }

  const source = sourceDuPlan(strategie?.in_zone_weights);
  if (source.type !== 'jeu_zones') {
    /*
     * 409 et non 404 : la campagne existe, la route existe, mais son plan ne
     * vient pas d'un jeu de zones — il n'y a donc pas de classes à ventiler.
     * L'écran doit simplement ne pas afficher ce bloc, pas signaler une panne.
     */
    return NextResponse.json(
      {
        error: 'Le plan de cette campagne ne vient pas d’un jeu de zones.',
        raison: 'plan_sans_zones',
        source: source.type,
      },
      { status: 409 },
    );
  }

  /*
   * Le PROFIL du jeu voyage avec le résultat. Sans lui, l'écran ne peut pas
   * nommer les bandes : `haut:2` se dit « 1 km à 2 km » sur un profil et
   * autrement sur un autre. Faute de profil, le libellé retombait sur
   * « NaN km à ? » — un chiffre absurde qui fait douter des chiffres justes
   * affichés juste à côté.
   */
  const { data: jeuRow, error: erreurJeu } = await supabase
    .from('zone_sets')
    .select('profil')
    .eq('id', source.zoneSetId)
    .maybeSingle();
  if (erreurJeu) {
    console.error('[pression-classes] profil du jeu :', erreurJeu.message);
  }

  const { data, error } = await supabase.rpc('pression_par_classe', {
    p_campaign_id: campaignId,
    p_zone_set_id: source.zoneSetId,
  });

  // Le message Postgres est JOURNALISÉ, jamais renvoyé : il porte la forme des
  // tables et des colonnes. Le client reçoit une phrase neutre. Même patron
  // que `alignement/route.ts`.
  if (error) {
    console.error('[pression-classes] pression_par_classe :', error.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }

  const resultat = rpcJson<Payload>(data);
  if (!resultat?.calculable) {
    const code = resultat?.error ?? '';
    return NextResponse.json(
      { error: MESSAGES[code] ?? 'Pression par classe indisponible.', raison: code },
      { status: 404 },
    );
  }

  return NextResponse.json(
    {
      ...resultat,
      jeu: {
        id: source.zoneSetId,
        nom: source.nom,
        version: source.version,
        // `null` quand la lecture a échoué : l'écran nommera les bandes par
        // leur rang plutôt que d'inventer des rayons.
        profil: jeuRow?.profil ?? null,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
