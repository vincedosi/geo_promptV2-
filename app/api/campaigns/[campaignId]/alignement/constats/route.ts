/**
 * GET /api/campaigns/[campaignId]/alignement/constats — « Ce qu'il faut
 * corriger » : au plus trois constats CALCULÉS (`calculerConstats`,
 * `lib/campagne/constats.ts`), jamais rédigés en dur.
 *
 * Trois appels, séquentiels (jamais de `Promise.all` au-delà des deux déjà
 * groupés dans `checkCampaignAccess`) :
 *  - `calculer_alignement_geo` (sql/165) pour `impressions_totales` et
 *    `depense_totale` — d'où `cpm_moyen` est dérivé ici (aucune RPC ne rend
 *    ce ratio tout fait, et il est trivial : jamais un aller-retour de plus
 *    pour un calcul qu'une division couvre) ;
 *  - `alignement_par_maille` (sql/165) à la maille DÉPARTEMENT, sans parent
 *    (vue nationale — c'est la granularité à laquelle « Ce qu'il faut
 *    corriger » raisonne, cf. maquette : « Le 13 et le 59… ») pour les
 *    `unites` ;
 *  - `get_campaign_actors` (sql/113) pour les `canaux` — n'exige PAS de
 *    stratégie active (il agrège `campaign_daily_rollup`), donc reste
 *    disponible même quand `alignement_par_maille` l'exige (le plan vient
 *    de `campaign_cp_rollup.planned_share`).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import { rpcJson } from '@/lib/supabase/rpc-json';
import { calculerConstats, type UniteConstat, type CanalConstat } from '@/lib/campagne/constats';

export const dynamic = 'force-dynamic';

const QuerySchema = z.object({
  tolerance: z.coerce.number().min(0).max(100).optional(),
  poids: z.coerce.number().min(0).max(5).optional(),
});

/** Payload de `calculer_alignement_geo` (sql/165) — `error` porte les cas métier. */
interface AlignementPayload {
  error?: string;
  impressions_totales?: number;
  depense_totale?: number;
  [key: string]: unknown;
}

/** Sous-ensemble d'`alignement_par_maille` (sql/165) utile aux constats. */
interface MaillePayload {
  error?: string;
  unites?: UniteConstat[];
}

/** Payload de `get_campaign_actors` (sql/113) — pas de champ `error` : agrège sans exiger de stratégie. */
interface ActeursPayload {
  actors?: { actor: string | null; cpm: number | null }[];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { campaignId } = await params;

  const supabase = createAdminClient();
  const access = await checkCampaignAccess(supabase, profile, campaignId);
  if (access !== 'ok') {
    return NextResponse.json({ error: 'Campagne introuvable.' }, { status: 404 });
  }

  const parsed = QuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: 'Paramètres invalides.' }, { status: 400 });
  }
  const { tolerance, poids } = parsed.data;

  // 1) Totaux campagne — pour cpm_moyen.
  const { data: dataAlignement, error: erreurAlignement } = await supabase.rpc('calculer_alignement_geo', {
    p_campaign_id: campaignId,
    p_tolerance: tolerance,
    p_poids: poids,
  });
  // Le message d'erreur Postgres est JOURNALISÉ, jamais renvoyé : il porte la
  // forme des tables et des colonnes. Le client reçoit une phrase neutre.
  // Patron du dépôt : `activation/prevol/route.ts:67-70`.
  if (erreurAlignement) {
    console.error('[alignement/constats] calculer_alignement_geo:', erreurAlignement.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }
  const alignement = rpcJson<AlignementPayload>(dataAlignement);
  if (alignement?.error) {
    return NextResponse.json({ error: alignement.error }, { status: 404 });
  }

  const impressionsTotales = alignement?.impressions_totales ?? 0;
  const depenseTotale = alignement?.depense_totale ?? 0;
  const cpmMoyen = impressionsTotales > 0 ? (depenseTotale / impressionsTotales) * 1000 : null;

  // 2) Unités (maille département, vue nationale).
  const { data: dataMaille, error: erreurMaille } = await supabase.rpc('alignement_par_maille', {
    p_campaign_id: campaignId,
    p_maille: 'departement',
    p_tolerance: tolerance,
  });
  if (erreurMaille) {
    console.error('[alignement/constats] alignement_par_maille:', erreurMaille.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }
  const maille = rpcJson<MaillePayload>(dataMaille);
  if (maille?.error) {
    return NextResponse.json({ error: maille.error }, { status: 404 });
  }

  // 3) Canaux (acteurs) — indépendant d'une stratégie active.
  const { data: dataActeurs, error: erreurActeurs } = await supabase.rpc('get_campaign_actors', {
    p_campaign_id: campaignId,
  });
  if (erreurActeurs) {
    console.error('[alignement/constats] get_campaign_actors:', erreurActeurs.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }
  const acteurs = rpcJson<ActeursPayload>(dataActeurs);

  const unites: UniteConstat[] = maille?.unites ?? [];
  const canaux: CanalConstat[] = (acteurs?.actors ?? [])
    .filter((a): a is { actor: string; cpm: number | null } => !!a.actor)
    .map((a) => ({ code: a.actor, cpm: a.cpm }));

  const constats = calculerConstats({ unites, cpm_moyen: cpmMoyen, canaux });

  return NextResponse.json({ constats }, { headers: { 'Cache-Control': 'no-store' } });
}
