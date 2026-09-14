/**
 * GET /api/campaigns/[campaignId]/alignement — score d'alignement géographique
 * (RPC `calculer_alignement_geo`, sql/165), TOUJOURS calculé au code postal.
 *
 * `variation_7j` n'est pas produit par la RPC (qui rend `score` et
 * `score_prev_7j` séparément) : dérivée ici, `score - score_prev_7j`, pour
 * tenir le contrat d'interface de la Tâche 5.
 *
 * L'étalon (`etalon_alignement`) est lu à part et SUR LES PARAMÈTRES PAR
 * DÉFAUT (Task 3) : un étalon qui suivrait le réglage de la campagne ne
 * comparerait plus rien.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import { rpcJson } from '@/lib/supabase/rpc-json';

export const dynamic = 'force-dynamic';

const QuerySchema = z.object({
  tolerance: z.coerce.number().min(0).max(100).optional(),
  poids: z.coerce.number().min(0).max(5).optional(),
});

/** Payload de `calculer_alignement_geo` (sql/165) — `error` porte les cas métier. */
interface AlignementPayload {
  error?: string;
  score?: number;
  score_prev_7j?: number;
  [key: string]: unknown;
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

  const { data, error } = await supabase.rpc('calculer_alignement_geo', {
    p_campaign_id: campaignId,
    p_tolerance: parsed.data.tolerance,
    p_poids: parsed.data.poids,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const resultat = rpcJson<AlignementPayload>(data);
  if (resultat?.error) {
    return NextResponse.json({ error: resultat.error }, { status: 404 });
  }

  // L'étalon est lu à part et SUR LES PARAMÈTRES PAR DÉFAUT : un étalon qui
  // suivrait le réglage de la campagne ne comparerait plus rien.
  const { data: etalon } = await supabase
    .from('etalon_alignement')
    .select('score_median, n_campagnes, tolerance_pct')
    .single();

  const variation_7j =
    typeof resultat?.score === 'number' && typeof resultat?.score_prev_7j === 'number'
      ? resultat.score - resultat.score_prev_7j
      : null;

  return NextResponse.json(
    { ...resultat, variation_7j, etalon },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
