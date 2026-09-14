/**
 * GET /api/campaigns/[campaignId]/alignement/constats — « Ce qu'il faut
 * corriger » : au plus trois constats CALCULÉS (`calculerConstats`,
 * `lib/campagne/constats.ts`), jamais rédigés en dur.
 *
 * Deux appels, séquentiels (jamais de `Promise.all` au-delà des deux déjà
 * groupés dans `checkCampaignAccess`) :
 *  - `alignement_par_maille` (sql/165) à la maille DÉPARTEMENT, sans parent
 *    (vue nationale — c'est la granularité à laquelle « Ce qu'il faut
 *    corriger » raisonne, cf. maquette : « Le 13 et le 59… ») pour les
 *    `unites` ;
 *  - `get_campaign_actors` (sql/113) pour les `canaux` — n'exige PAS de
 *    stratégie active (il agrège `campaign_daily_rollup` directement).
 *
 * Ruling T11-1 (relecture) : `cpm_moyen` était dérivé de `calculer_alignement_geo`
 * (`impressions_totales`/`depense_totale`, donc de `campaign_cp_rollup`), pour
 * être comparé au CPM d'un canal issu de `get_campaign_actors` (donc de
 * `campaign_daily_rollup`). DEUX TABLES DIFFÉRENTES dans la même phrase — un
 * ratio entre deux grandeurs qui ne viennent pas du même agrégat n'a pas de
 * sens, même quand les nombres coïncident. `refresh_campaign_rollups`
 * (sql/113, lignes 31-70) remplit les deux tables depuis `dsp_campaign_data`
 * avec des FILTRES DIFFÉRENTS (`date IS NOT NULL` pour l'une, `postal_code
 * IS NOT NULL` pour l'autre) : rien ne garantit que leurs totaux coïncident.
 * Mesuré sur la campagne démo (2026-09-14) : ils coïncident EXACTEMENT
 * (3 936 390 impressions et CPM 6,5263 des deux côtés, zéro ligne
 * asymétrique) — le risque de divergence n'est donc pas réalisé aujourd'hui.
 * Mais la correction ne dépend pas de ce risque : `cpm_moyen` est désormais
 * dérivé des `canaux` eux-mêmes (`Σ dépense / Σ impressions × 1000`,
 * pondéré), donc comparé PAR CONSTRUCTION aux mêmes lignes, dans la même
 * table — plus de calculer_alignement_geo ici, plus de deuxième RPC à garder
 * synchronisée avec ce que cette route compare réellement.
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
});

/** Sous-ensemble d'`alignement_par_maille` (sql/165) utile aux constats. */
interface MaillePayload {
  error?: string;
  unites?: UniteConstat[];
}

/**
 * Payload de `get_campaign_actors` (sql/113) — pas de champ `error` : agrège
 * sans exiger de stratégie. `impressions`/`spend` portés ici (pas seulement
 * `cpm`) précisément pour dériver `cpm_moyen` des mêmes lignes (ruling T11-1).
 */
interface ActeursPayload {
  actors?: { actor: string | null; cpm: number | null; impressions: number | null; spend: number | null }[];
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
  const { tolerance } = parsed.data;

  // 1) Unités (maille département, vue nationale).
  const { data: dataMaille, error: erreurMaille } = await supabase.rpc('alignement_par_maille', {
    p_campaign_id: campaignId,
    p_maille: 'departement',
    p_tolerance: tolerance,
  });
  // Le message d'erreur Postgres est JOURNALISÉ, jamais renvoyé : il porte la
  // forme des tables et des colonnes. Le client reçoit une phrase neutre.
  // Patron du dépôt : `activation/prevol/route.ts:67-70`.
  if (erreurMaille) {
    console.error('[alignement/constats] alignement_par_maille:', erreurMaille.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }
  const maille = rpcJson<MaillePayload>(dataMaille);
  if (maille?.error) {
    return NextResponse.json({ error: maille.error }, { status: 404 });
  }

  // 2) Canaux (acteurs) — indépendant d'une stratégie active.
  const { data: dataActeurs, error: erreurActeurs } = await supabase.rpc('get_campaign_actors', {
    p_campaign_id: campaignId,
  });
  if (erreurActeurs) {
    console.error('[alignement/constats] get_campaign_actors:', erreurActeurs.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }
  const acteurs = rpcJson<ActeursPayload>(dataActeurs);
  const listeActeurs = acteurs?.actors ?? [];

  const unites: UniteConstat[] = maille?.unites ?? [];
  const canaux: CanalConstat[] = listeActeurs
    .filter((a): a is { actor: string; cpm: number | null; impressions: number | null; spend: number | null } => !!a.actor)
    .map((a) => ({ code: a.actor, cpm: a.cpm }));

  // Ruling T11-1 : cpm_moyen dérivé des MÊMES lignes que les canaux comparés
  // (get_campaign_actors), jamais d'une autre table — voir le commentaire
  // d'en-tête. Pondéré par les impressions, pas une moyenne simple des CPM.
  const sommeImpressions = listeActeurs.reduce((s, a) => s + (a.impressions ?? 0), 0);
  const sommeSpend = listeActeurs.reduce((s, a) => s + (a.spend ?? 0), 0);
  const cpmMoyen = sommeImpressions > 0 ? (sommeSpend / sommeImpressions) * 1000 : null;

  const constats = calculerConstats({ unites, cpm_moyen: cpmMoyen, canaux });

  return NextResponse.json({ constats }, { headers: { 'Cache-Control': 'no-store' } });
}
