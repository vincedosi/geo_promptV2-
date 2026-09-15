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
 * Step 2). Repli sur `abstention_pres_2022` si la campagne n'a pas de
 * stratégie ou que celle-ci ne porte pas de `variable_code`.
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
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import { rpcJson } from '@/lib/supabase/rpc-json';
import type { ReponseAlignementMailleGeo } from '@/lib/campagne/vignette-carte';

export const dynamic = 'force-dynamic';

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

  // Variable par défaut = celle de la stratégie de bidding active de la
  // campagne, jamais une constante recopiée. `?variable=` la surcharge.
  let variableCode = variable;
  if (!variableCode) {
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
    const poids = strategie?.in_zone_weights as { variable_code?: string } | null;
    variableCode = poids?.variable_code || VARIABLE_DEFAUT;
  }

  const { data, error } = await supabase.rpc('alignement_par_maille_geo', {
    p_campaign_id: campaignId,
    p_maille: maille,
    p_parent: parent,
    p_variable_code: variableCode,
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

  return NextResponse.json(resultat, { headers: { 'Cache-Control': 'no-store' } });
}
