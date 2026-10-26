/**
 * @file app/api/zones/jeux/[id]/extractions/[version]/cp/route.ts
 *
 * GET — les codes postaux ACHETÉS d'une extraction figée, avec leur multiplicateur (lot 6, T1, arbitrage A-11).
 *
 * L'étape ⑥ de la carte en tire les impressions prévues par CP : impressions de la plateforme × multiplicateur du CP
 * ÷ Σ multiplicateurs de SES CP — la formule de `planned_share` (`refresh_campaign_rollups`).
 *
 * - sans `?plateforme=` : le plan CP de l'extraction, celui que `rattacher` recopie (`multiplicateur > 0`) ;
 * - avec : les CP de CETTE plateforme — ses unités retenues à la maille CP (`zone_set_extraction_unites`, sql/278),
 *   ramenées à leur code canonique pour garder un groupe de CP indiscernables entier, comme le plan l'achète.
 *   Une plateforme qui n'achète pas au CP (cercles, communes, polygone) rend une liste vide ; un jeu RISQUE (sans
 *   résumé `plateformes`) rend son plan entier (lot 7, A-1).
 *
 * Réponse : `{ cp: [{ code_postal, multiplicateur }], total, retenus }`, en codes postaux BRUTS — l'unité que
 * `rattacher` écrit dans `bidding_zone_configs` (un groupe indiscernable : une ligne par membre). `total` = lignes
 * rendues, `retenus` = celles qui sont retenues ; l'écran ⑥ en fait « N CP au plan, dont M retenus » (preuve du
 * lot 6). `n_retenus` de l'extraction compte, lui, des codes canoniques. Les deux types de jeu.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { chargerJeu } from '@/lib/zones/charger-jeu';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { lireCpPlateforme } from '@/lib/zones/cp-plateforme';
import { messageAnomalies } from '@/lib/api/valider-corps';

export const dynamic = 'force-dynamic';

/** Une lecture d'écran, mise en cache par le client : plafond large, il empêche une boucle. */
const limiteur = createRateLimiter({ max: 30, window: '60 s', prefix: 'geo:rl:zone-set-extraction-cp' });

const ParametresSchema = z.object({
  version: z.coerce.number().int().min(1),
  plateforme: z.string().trim().min(1).max(50).optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; version: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  if (!profile.organization_id) {
    return NextResponse.json({ error: 'Aucune organisation active.' }, { status: 403 });
  }

  const { id, version } = await params;
  const lus = ParametresSchema.safeParse({
    version,
    plateforme: request.nextUrl.searchParams.get('plateforme') ?? undefined,
  });
  if (!lus.success) return NextResponse.json({ error: messageAnomalies(lus.error) }, { status: 400 });

  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const supabase = createAdminClient();

  // Sans type : les deux types de jeu ont un plan CP d'extraction. L'espace est vérifié par le chargeur (pas de RLS).
  const charge = await chargerJeu(supabase, id, profile.organization_id);
  if (!charge.ok) return charge.reponse;

  const { data: x, error } = await supabase
    .from('zone_set_extractions')
    .select('id')
    .eq('zone_set_id', id)
    .eq('version', lus.data.version)
    .maybeSingle();
  if (error) {
    console.error('[zones/extraction cp] lecture :', error.message);
    return NextResponse.json({ error: 'Extraction illisible.' }, { status: 500 });
  }
  if (!x) {
    return NextResponse.json({ error: `Ce jeu de zones n’a pas de version ${lus.data.version}.` }, { status: 404 });
  }

  try {
    // Lecture partagée avec ⑦ (pré-vol, poussée, fichier) : `lib/zones/cp-plateforme.ts` (lot 7, A-1).
    const lignes = await lireCpPlateforme(supabase, x.id, lus.data.plateforme);
    const cp = lignes.map(({ code_postal, multiplicateur }) => ({ code_postal, multiplicateur }));
    const retenus = lignes.filter((l) => l.retenu).length;
    return NextResponse.json({ cp, total: cp.length, retenus });
  } catch (e) {
    console.error('[zones/extraction cp] lignes :', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Codes postaux de l’extraction illisibles.' }, { status: 500 });
  }
}
