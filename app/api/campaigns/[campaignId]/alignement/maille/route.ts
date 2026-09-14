/**
 * GET /api/campaigns/[campaignId]/alignement/maille — agrégation de
 * l'alignement géographique (RPC `alignement_par_maille`, sql/165) à la
 * maille demandée (région / département / CP), pour le tableau, les tuiles
 * carte et le fil d'Ariane.
 *
 * Le score lui-même ne change JAMAIS avec la maille — il reste TOUJOURS
 * calculé au code postal par `calculer_alignement_geo`. Cette route ne fait
 * que regrouper les mêmes écarts à un niveau de lecture différent, via la
 * jointure INSEE réelle (`ref_codes_postaux.code_dept` → `ref_departements`
 * → `ref_regions`) — jamais `campaign_cp_rollup.dept`, qui effondre tous les
 * DROM sur `97` sans porter aucun nom.
 *
 * En maille `cp` SANS parent, la liste nationale ferait ~2 041 unités : la
 * route la borne à 200 (même sans demande explicite du client) et renseigne
 * toujours `n_total` — la page doit pouvoir dire « 200 sur 2 041, les plus
 * déréglées », jamais laisser croire à une liste exhaustive. Avec un
 * `parent` (drill-down département/région), la limite demandée s'applique
 * normalement : l'ensemble drillé est déjà borné par construction.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import { rpcJson } from '@/lib/supabase/rpc-json';

export const dynamic = 'force-dynamic';

const QuerySchema = z.object({
  maille: z.enum(['region', 'departement', 'cp']).default('departement'),
  parent: z.string().max(10).optional(),
  limite: z.coerce.number().int().min(1).max(500).default(200),
});

/** Une unité agrégée (région, département ou CP) rendue par la RPC. */
interface UniteMaille {
  code: string | null;
  nom: string | null;
  impressions: number;
  spend: number | null;
  cpm: number | null;
  plan: number | null;
  ecart_pct: number | null;
}

/** Payload de `alignement_par_maille` (sql/165) — `error` porte les cas métier. */
interface MaillePayload {
  error?: string;
  maille?: string;
  parent?: string | null;
  n_total?: number;
  unites?: UniteMaille[];
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

  const { maille, parent, limite } = parsed.data;

  // Maille CP sans parent = vue nationale (~2 041 unités) : plafond fixe de
  // 200, quelle que soit la limite demandée par le client. Avec un parent
  // (drill-down), l'ensemble est déjà borné par la géographie et la limite
  // demandée s'applique telle quelle.
  const limiteEffective = maille === 'cp' && !parent ? Math.min(limite, 200) : limite;

  const { data, error } = await supabase.rpc('alignement_par_maille', {
    p_campaign_id: campaignId,
    p_maille: maille,
    p_parent: parent,
    p_limite: limiteEffective,
  });
  // Le message d'erreur Postgres est JOURNALISÉ, jamais renvoyé : il porte la
  // forme des tables et des colonnes. Le client reçoit une phrase neutre.
  // Patron du dépôt : `activation/prevol/route.ts:67-70`.
  if (error) {
    console.error('[alignement/maille] alignement_par_maille:', error.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }

  const resultat = rpcJson<MaillePayload>(data);
  if (resultat?.error) {
    return NextResponse.json({ error: resultat.error }, { status: 404 });
  }

  return NextResponse.json(resultat, { headers: { 'Cache-Control': 'no-store' } });
}
