/**
 * GET /api/campaigns/[campaignId]/alignement/maille/map — géométrie des
 * trois vignettes carte du Suivi V2 (Tâche 13A) : impressions, variable du
 * plan, alignement. RPC dédiée `alignement_par_maille_geo` (sql/165,
 * ruling T13A-1) — JAMAIS `alignement_par_maille`, qui sert le tableau et
 * n'a pas besoin de géométrie (ruling T6-1). Patron déjà établi dans ce
 * dépôt : `/suivi` contre `/suivi/map`.
 *
 * La variable du plan par défaut est celle de la stratégie de bidding active
 * de la campagne (`bidding_strategies.in_zone_weights->>'variable_code'`),
 * jamais une constante recopiée — `?variable=` la surcharge explicitement
 * (sélecteur d'un autre indicateur de `cible_indicator_registry`, Tâche 13
 * Step 2).
 *
 * ⚠ **Le repli sur `abstention_pres_2022` ne vaut QUE pour un plan bâti sur
 * un indicateur.** Un plan issu d'un JEU DE ZONES n'a aucune variable
 * derrière lui : y replier faisait afficher « taux d'abstention » sous le
 * titre « la variable qui a servi à bâtir le plan », pour une campagne dont
 * le plan vient d'anneaux autour de sites classés. La réponse porte donc
 * `source_plan`, et chaque unité porte `part_plan_pct` (sql/216) — la part du
 * plan elle-même, qui se passe de proxy.
 *
 * Maille région SANS parent est la racine de la hiérarchie : passer un
 * `parent` est refusé en 400 (ruling T6-4, même garde que
 * `alignement/maille/route.ts`) plutôt que de laisser la RPC rendre une
 * liste vide en silence, indiscernable d'une campagne sans donnée.
 *
 * Bbox par défaut = métropole (même défaut que `suivi/map`) — c'est aussi
 * elle qui fixe la tolérance de simplification de la géométrie côté RPC
 * (ruling T13A-1) : la vignette paie la précision qu'elle affiche, pas plus.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sourceDuPlan } from '@/lib/campagne/source-plan';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { indicateursVisibles } from '@/lib/auth/perimetre-donnees';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { rpcJson } from '@/lib/supabase/rpc-json';
import type { ReponseAlignementMailleGeo } from '@/lib/campagne/vignette-carte';

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


const VARIABLE_DEFAUT = 'abstention_pres_2022';
const BBOX_METRO = [-5.5, 41.2, 9.8, 51.2] as const;

const QuerySchema = z.object({
  maille: z.enum(['region', 'departement', 'cp']).default('departement'),
  parent: z.string().max(10).optional(),
  variable: z.string().max(100).optional(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  limite: z.coerce.number().int().min(1).max(3000).default(3000),
});

/** Payload de `alignement_par_maille_geo` (sql/165) — `error` porte les cas métier. */
interface MaillePayload extends Partial<ReponseAlignementMailleGeo> {
  error?: string;
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

  const sp = request.nextUrl.searchParams;
  const bboxRaw = sp.get('bbox');
  const bbox = bboxRaw ? bboxRaw.split(',').map(Number) : undefined;

  const parsed = QuerySchema.safeParse({
    maille: sp.get('maille') ?? undefined,
    parent: sp.get('parent') ?? undefined,
    variable: sp.get('variable') ?? undefined,
    bbox,
    limite: sp.get('limite') ?? undefined,
  });
  if (!parsed.success || (bbox && bbox.some((v) => !Number.isFinite(v)))) {
    return NextResponse.json({ error: 'Paramètres invalides.' }, { status: 400 });
  }
  const { maille, parent, variable, limite } = parsed.data;
  const bboxEffective = parsed.data.bbox ?? BBOX_METRO;

  // Région est la racine de la hiérarchie : elle n'a pas de parent. Sans
  // cette garde, aucune branche du `where` de la RPC ne correspondrait et la
  // vignette reviendrait vide en silence (ruling T6-4) — indiscernable d'une
  // campagne sans donnée. 400 explicite à la place.
  if (maille === 'region' && parent) {
    return NextResponse.json(
      { error: "La maille région est la racine : elle n'accepte pas de parent." },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const access = await checkCampaignAccess(supabase, profile, campaignId);
  if (access !== 'ok') {
    return NextResponse.json({ error: 'Campagne introuvable.' }, { status: 404 });
  }

  /*
   * La source du plan est lue DANS TOUS LES CAS, même quand `?variable=` est
   * fourni : le client en a besoin pour titrer la vignette, et la surcharge ne
   * change pas d'où vient le plan — elle change seulement ce qu'on regarde
   * à côté.
   */
  const { data: strategie, error: erreurStrategie } = await supabase
    .from('bidding_strategies')
    .select('in_zone_weights')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (erreurStrategie) {
    console.error('[alignement/maille/map] bidding_strategies:', erreurStrategie.message);
  }
  const source = sourceDuPlan(strategie?.in_zone_weights);

  // Variable par défaut = celle de la stratégie, jamais une constante
  // recopiée. `?variable=` la surcharge.
  let variableCode: string | null = variable ?? null;
  if (!variableCode) {
    variableCode = source.type === 'indicateur' ? source.code : VARIABLE_DEFAUT;
  }
  // Un indicateur invisible de l'espace actif (sql/288) — demandé, celui du plan ou le repli sur l'abstention — donne
  // « aucune variable » (valeurs nulles), jamais une erreur : la vignette d'impressions et l'alignement restent dus.
  if (!(await indicateursVisibles(request)).visibles.has(variableCode)) variableCode = null;

  const { data, error } = await supabase.rpc('alignement_par_maille_geo', {
    p_campaign_id: campaignId,
    p_maille: maille,
    p_parent: parent,
    // `null` et non `undefined` : omis, l'argument retomberait sur son défaut SQL, `abstention_pres_2022` — celui
    // qu'on vient peut-être de refuser. Les types générés ne connaissent pas `null` pour un argument ; la fonction le
    // reçoit (aucune ligne d'`indicator_cp_values` ne joint : `variable_valeur` nulle partout).
    p_variable_code: variableCode as string,
    p_bbox_xmin: bboxEffective[0],
    p_bbox_ymin: bboxEffective[1],
    p_bbox_xmax: bboxEffective[2],
    p_bbox_ymax: bboxEffective[3],
    p_limite: limite,
  });
  // Le message d'erreur Postgres est JOURNALISÉ, jamais renvoyé : il porte la
  // forme des tables et des colonnes. Le client reçoit une phrase neutre.
  // Patron du dépôt : `alignement/route.ts`, `activation/prevol/route.ts:67-70`.
  if (error) {
    console.error('[alignement/maille/map] alignement_par_maille_geo:', error.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }

  const resultat = rpcJson<MaillePayload>(data);
  if (resultat?.error) {
    return NextResponse.json({ error: resultat.error }, { status: 404 });
  }

  /*
   * `source_plan` voyage AVEC les features. Sans lui, le client ne peut pas
   * savoir si `variable_valeur` décrit le plan ou seulement un indicateur
   * affiché à côté — et c'est cette ignorance qui lui faisait titrer
   * « la variable qui a servi à bâtir le plan » sur un plan de zones.
   */
  return NextResponse.json(
    { ...resultat, source_plan: source },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
