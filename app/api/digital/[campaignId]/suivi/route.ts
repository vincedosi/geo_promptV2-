/**
 * GET /api/digital/[campaignId]/suivi — payload complet du cockpit de suivi
 * (RPC get_campaign_suivi, lecture des rollups uniquement).
 *
 * Backfill lazy : si les rollups n'existent pas encore (campagne historique,
 * jamais réimportée depuis la 107), on les construit UNE fois puis on relit —
 * uniquement pour les campagnes avec stratégie (le cockpit n'a pas de sens
 * sans budget/plan, et ça évite de scanner les très grosses campagnes
 * d'import pur type démo nationale).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { rpcJson } from '@/lib/supabase/rpc-json';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import { parseActorsParam } from '@/lib/campaigns/actor-metrics';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { campaignId } = await params;

  const pActors = parseActorsParam(request.nextUrl.searchParams);

  const supabase = createAdminClient();
  const access = await checkCampaignAccess(supabase, profile, campaignId);
  if (access !== 'ok') return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });

  /** Payload de `get_campaign_suivi` (sql/108) — `error` porte les cas metier. */
  type SuiviPayload = { error?: string };

  let { data, error } = await supabase.rpc('get_campaign_suivi', { p_campaign_id: campaignId, p_actors: pActors ?? undefined });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  let payload = rpcJson<SuiviPayload>(data);

  /*
   * ⚠ Le code brut ne repart PLUS au client. Il le faisait jusqu'au
   * 2026-09-20, et l'écran le traduisait à sa façon : « La dernière
   * actualisation a échoué — les chiffres affichés datent d'avant. » Deux
   * mensonges dans une phrase — rien n'avait échoué (`refresh_campaign_rollups`
   * fonctionne, vérifié) et les chiffres ne dataient pas d'avant.
   *
   * Un code métier brut affiché à l'utilisateur est un message technique qui a
   * fui : c'est la règle que `alignement/route.ts` applique déjà avec sa table
   * `MESSAGES_METIER`. `raison` reste là pour que l'écran distingue les cas
   * sans comparer des phrases françaises.
   */
  if (payload?.error === 'no_strategy') {
    return NextResponse.json(
      {
        error:
          'Cette campagne n’a pas de plan géographique : le suivi de pression n’a rien à '
          + 'quoi comparer la diffusion. Rattachez-lui un jeu de zones ou une variable de '
          + 'ciblage depuis l’onglet Stratégie.',
        raison: 'no_strategy',
      },
      { status: 409 },
    );
  }
  if (payload?.error === 'no_rollup') {
    const { error: refreshErr } = await supabase.rpc('refresh_campaign_rollups', { p_campaign_id: campaignId });
    if (refreshErr) return NextResponse.json({ error: refreshErr.message }, { status: 500 });
    ({ data, error } = await supabase.rpc('get_campaign_suivi', { p_campaign_id: campaignId, p_actors: pActors ?? undefined }));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    payload = rpcJson<SuiviPayload>(data);
    if (payload?.error) return NextResponse.json({ error: payload.error }, { status: 409 });
  }

  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}
