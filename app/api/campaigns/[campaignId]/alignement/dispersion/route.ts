/**
 * GET /api/campaigns/[campaignId]/alignement/dispersion — histogramme de
 * dispersion des écarts au plan par code postal (RPC `alignement_dispersion_cp`,
 * sql/165). Sert la maille CP de `GraphiqueEcart` : à cette granularité, une
 * courbe de ~2 000 points ne raconte rien — elle est remplacée par un
 * histogramme dans les 7 bandes fixes de `BORNES_DIVERGENTES`
 * (`lib/campagne/palette-divergente.ts`), jamais retypées ici.
 *
 * `parent` désigne un département (ou, à titre permissif, une région) sur
 * lequel restreindre les CP affichés — jamais les totaux de normalisation,
 * qui restent calculés sur le périmètre COMPLET de la campagne côté RPC
 * (même ruling que `alignement_par_maille`, T6-2).
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
import { rpcJson } from '@/lib/supabase/rpc-json';

export const dynamic = 'force-dynamic';

const QuerySchema = z.object({
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
