/**
 * GET /api/campaigns/[campaignId]/alignement/dispersion — histogramme de
 * dispersion des écarts au plan par code postal (RPC `alignement_dispersion_cp`,
 * sql/165). Sert la maille CP de `GraphiqueEcart` : à cette granularité, une
 * courbe de ~2 000 points ne raconte rien — elle est remplacée par un
 * histogramme dans les 7 bandes fixes de `BORNES_DIVERGENTES`
 * (`lib/campagne/palette-divergente.ts`), jamais retypées ici.
 *
 * `parent` désigne un **département**, et rien d'autre : cette route ne sert
 * que la maille CP, dont le niveau immédiatement au-dessus est le département
 * (fil d'Ariane région → département → CP). Il restreint les CP affichés —
 * jamais les totaux de normalisation, qui restent calculés sur le périmètre
 * COMPLET de la campagne côté RPC (même ruling que `alignement_par_maille`,
 * T6-2).
 *
 * L'en-tête annonçait auparavant « ou, à titre permissif, une région », et la
 * RPC filtrait en conséquence `code_dept = p_parent OR code_region = p_parent`.
 * Ce n'était pas une tolérance mais une confusion entre deux nomenclatures
 * INSEE qui **se recouvrent** : 18 codes désignent à la fois un département et
 * une région. Mesuré sur la campagne démo — `parent=75` (Paris, 21 CP) rendait
 * 164 CP, dont 143 en Nouvelle-Aquitaine (région '75'). Corrigé sql/171, qui
 * aligne le prédicat sur les deux RPC sœurs (elles le conditionnent déjà à la
 * maille demandée).
 *
 * `tolerance` est accepté pour la parité d'interface avec les routes sœurs
 * (`/alignement`, `/alignement/maille`) mais n'a aucun effet ici : les bandes
 * de l'histogramme sont l'échelle divergente universelle du produit, pas un
 * réglage par campagne.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { rpcJson } from '@/lib/supabase/rpc-json';

export const dynamic = 'force-dynamic';

/**
 * Quota PARTAGÉ par les cinq routes `alignement/*` (même préfixe, donc un seul
 * compteur en base par utilisateur).
 *
 * Il ne manquait pas par urgence : `EXPLAIN (ANALYZE, BUFFERS)` sur la plus
 * lourde des cinq, `alignement_par_maille_geo(…, 'cp', …)`, donne **288,7 ms,
 * `shared hit=10490`, 0 lecture disque**, et le sémaphore client
 * (`lib/campagne/semaphore-suivi.ts`, capacité 3) borne déjà l'écran. Mais ces
 * 10 490 buffers sont tous en cache SUR LA SEULE CAMPAGNE EN BASE : la même
 * page ouverte sur une campagne froide, ou plusieurs onglets, passe par le
 * disque sans aucun plafond partagé pour l'arrêter. Il manquait par symétrie
 * avec `geo:rl:analyse-score` et `geo:rl:analyse-correlation` (12/min chacun).
 *
 * 60/min et non 12 : un chargement de l'écran Suivi émet à lui seul CINQ
 * appels (une par route), et chaque descente dans le fil d'Ariane en émet
 * quatre. À 12/min le plafond aurait mordu sur l'usage normal — un quota qui
 * bloque un média planner qui travaille est un quota qu'on finit par retirer.
 * À 60, une exploration soutenue passe (≈ 13 descentes par minute) et une
 * boucle emballée est arrêtée en une seconde.
 *
 * Compteur PARTAGÉ en base (`consommer_quota`, sql/135) — jamais une `Map`
 * locale, qui ne limiterait rien sur Vercel (CLAUDE.md).
 */
const limiteur = createRateLimiter({ max: 60, window: '60 s', prefix: 'geo:rl:alignement' });


const QuerySchema = z.object({
  /** Code de DÉPARTEMENT — voir l'en-tête : jamais un code de région. */
  parent: z.string().max(10).optional(),
  tolerance: z.coerce.number().min(0).max(100).optional(),
});

/**
 * Une bande de l'histogramme. `borne_basse`/`borne_haute` sont `null` aux
 * deux extrémités de l'échelle (bornes ouvertes) — et, ensemble, sur l'UNE
 * ligne à part qui porte les CP à plan nul (aucun pourcentage d'écart n'est
 * définissable) : ~19,6 % de la campagne demo, mesuré le 2026-09-14. Cette
 * ligne n'est PAS perdue par la RPC ; c'est ici, à l'affichage, qu'on décide
 * de la montrer ou non.
 */
interface TrancheDispersion {
  borne_basse: number | null;
  borne_haute: number | null;
  n_cp: number;
  impressions: number;
}

/** Payload de `alignement_dispersion_cp` (sql/165). */
interface DispersionPayload {
  tranches?: TrancheDispersion[];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

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

  const { data, error } = await supabase.rpc('alignement_dispersion_cp', {
    p_campaign_id: campaignId,
    p_parent: parsed.data.parent,
    p_tolerance: parsed.data.tolerance,
  });
  // Le message d'erreur Postgres est JOURNALISÉ, jamais renvoyé : il porte la
  // forme des tables et des colonnes. Le client reçoit une phrase neutre.
  // Patron du dépôt : `activation/prevol/route.ts:67-70`.
  if (error) {
    console.error('[alignement/dispersion] alignement_dispersion_cp:', error.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }

  const resultat = rpcJson<DispersionPayload>(data);

  return NextResponse.json(resultat, { headers: { 'Cache-Control': 'no-store' } });
}
