/**
 * GET /api/campaigns/[campaignId]/alignement — score d'alignement géographique
 * (RPC `calculer_alignement_geo`, sql/165, corrigée sql/172), TOUJOURS calculé
 * au code postal.
 *
 * `variation_7j` n'est pas produit par la RPC (qui rend `score` et
 * `score_prev_7j` séparément) : dérivée ici, `score - score_prev_7j`, pour
 * tenir le contrat d'interface de la Tâche 5. **Seulement si la fenêtre
 * précédente existe** (`prev_7j_calculable`, sql/172) : sans ce drapeau, une
 * campagne d'une semaine voyait `score_prev_7j` retomber à 0 et l'écran
 * annonçait « +93 points en 7 jours », une progression fabriquée de toutes
 * pièces. `variation_7j: null` se lit déjà « inconnu » côté client, jamais
 * « stable » (`DiffusionMapLayer.tsx`, `ScoreAlignement.tsx`).
 *
 * ── Campagne sans données de diffusion (sql/172) ──────────────────────────
 * La RPC rend `{error: 'aucune_donnee', calculable: false}` plutôt qu'un score
 * de 0 — qui ne venait pas d'un calcul mais d'un `greatest(0, NULL)`. Cette
 * route le traduit en 404 avec une phrase française : « pas encore de données »
 * est un état, pas un alignement catastrophique. Les codes métier de la RPC ne
 * repartent JAMAIS tels quels au client (`campagne_introuvable` était rendu
 * brut avant ce correctif).
 *
 * ── L'étalon (« moyenne du secteur ») ─────────────────────────────────────
 * Lu à part et SUR LES PARAMÈTRES PAR DÉFAUT (Tâche 3) : un étalon qui
 * suivrait le réglage de la campagne ne comparerait plus rien.
 *
 * **Il n'est rendu que s'il a été CALCULÉ** (`n_campagnes > 0`). `sql/166` a
 * posé une graine — `score_median = 64, n_campagnes = 0` — en annonçant « à
 * remplacer par le calcul réel », et aucun code n'écrit jamais dans
 * `etalon_alignement` (vérifié : une seule lecture, aucun `insert`/`update`
 * hors du seed). Le 64 était donc servi tel quel : un média planner lisait
 * « votre score 93 est au-dessus de la moyenne du secteur (64) » et pouvait le
 * reprendre dans une recommandation client, alors que ce nombre n'a jamais été
 * calculé sur une seule campagne. Un repère faux est pire qu'un repère absent —
 * `etalon: null` laisse le composant ne rien afficher, ce que le type
 * `ReponseAlignement` prévoit déjà (`etalon: {…} | null`).
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
  tolerance: z.coerce.number().min(0).max(100).optional(),
  poids: z.coerce.number().min(0).max(5).optional(),
});

/** Payload de `calculer_alignement_geo` (sql/165, sql/172). */
interface AlignementPayload {
  error?: string;
  calculable?: boolean;
  score?: number;
  score_prev_7j?: number;
  prev_7j_calculable?: boolean;
  [key: string]: unknown;
}

/**
 * Les codes métier de la RPC, traduits. Un code brut (`aucune_donnee`)
 * affiché à l'utilisateur est un message d'erreur technique qui a fui.
 */
const MESSAGES_METIER: Record<string, string> = {
  campagne_introuvable: 'Campagne introuvable.',
  aucune_donnee:
    'Cette campagne n’a pas encore de données de diffusion : le score d’alignement n’est pas calculable.',
};

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

  const { data, error } = await supabase.rpc('calculer_alignement_geo', {
    p_campaign_id: campaignId,
    p_tolerance: parsed.data.tolerance,
    p_poids: parsed.data.poids,
  });
  // Le message d'erreur Postgres est JOURNALISÉ, jamais renvoyé : il porte la
  // forme des tables et des colonnes. Le client reçoit une phrase neutre.
  // Patron du dépôt : `activation/prevol/route.ts:67-70`.
  if (error) {
    console.error('[alignement] calculer_alignement_geo:', error.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }

  const resultat = rpcJson<AlignementPayload>(data);
  if (resultat?.error) {
    return NextResponse.json(
      {
        error: MESSAGES_METIER[resultat.error] ?? 'Score d’alignement indisponible.',
        raison: resultat.error,
        calculable: false,
      },
      { status: 404 },
    );
  }

  // L'étalon est lu à part et SUR LES PARAMÈTRES PAR DÉFAUT : un étalon qui
  // suivrait le réglage de la campagne ne comparerait plus rien.
  const { data: etalonLu, error: erreurEtalon } = await supabase
    .from('etalon_alignement')
    .select('score_median, n_campagnes, tolerance_pct')
    .single();
  if (erreurEtalon) console.error('[alignement] etalon:', erreurEtalon.message);

  // `n_campagnes = 0` ⇒ la valeur est la GRAINE de sql/166, pas une mesure.
  // On ne la sert pas : voir l'en-tête.
  const etalon =
    etalonLu && etalonLu.n_campagnes != null && etalonLu.n_campagnes > 0
      ? etalonLu
      : null;

  // `prev_7j_calculable` faux ⇒ la fenêtre précédente est vide, et
  // `score_prev_7j` y vaut 0 par accident d'agrégation, pas par mesure.
  const variation_7j =
    resultat?.prev_7j_calculable === true &&
    typeof resultat?.score === 'number' &&
    typeof resultat?.score_prev_7j === 'number'
      ? resultat.score - resultat.score_prev_7j
      : null;

  return NextResponse.json(
    { ...resultat, variation_7j, etalon },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
