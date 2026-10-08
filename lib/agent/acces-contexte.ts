/**
 * lib/agent/acces-contexte.ts
 * L'appelant a-t-il le droit de parler à l'agent de CE contexte ?
 *
 * Les routes `/api/agent/*` reçoivent du navigateur un `campaign_id`, un
 * `strategy_id` ou un `drift_event_id`, et l'agent lit ensuite la campagne,
 * la stratégie et ses données par service_role. Jusqu'au 2026-10-08, aucun
 * de ces identifiants n'était contrôlé : un client obtenait l'analyse — noms,
 * codes postaux, métriques — de la stratégie d'une autre organisation en
 * envoyant son identifiant.
 *
 * Même règle que les routes de campagne (`lib/campaigns/access.ts`) :
 * organisation propriétaire ou liée, super_admin partout.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkCampaignAccess, checkStrategyAccess, type CampaignAccess } from '@/lib/campaigns/access';

export interface ContexteAgent {
  campaign_id?: string;
  strategy_id?: string;
  drift_event_id?: string;
}

/**
 * Contrôle chaque identifiant présent dans le contexte.
 *
 * @returns `'ok'` si TOUS sont accessibles (ou s'il n'y en a aucun), sinon le
 *   premier refus — `'not_found'` ou `'forbidden'`.
 */
export async function verifierContexteAgent(
  supabase: SupabaseClient,
  profile: { role: string; organization_id: string | null },
  contexte: ContexteAgent,
): Promise<CampaignAccess> {
  if (contexte.campaign_id) {
    const acces = await checkCampaignAccess(supabase, profile, contexte.campaign_id);
    if (acces !== 'ok') return acces;
  }
  if (contexte.strategy_id) {
    const acces = await checkStrategyAccess(supabase, profile, contexte.strategy_id);
    if (acces !== 'ok') return acces;
  }
  if (contexte.drift_event_id) {
    const { data, error } = await supabase
      .from('bidding_drift_events')
      .select('strategy_id')
      .eq('id', contexte.drift_event_id)
      .maybeSingle();
    if (error || !data?.strategy_id) return 'not_found';
    const acces = await checkStrategyAccess(supabase, profile, data.strategy_id as string);
    if (acces !== 'ok') return acces;
  }
  return 'ok';
}
