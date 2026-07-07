/**
 * Contrôle d'accès aux campagnes DSP par organisation.
 *
 * Règle (décision scoping workspace 07/2026, cohérente avec la RLS) :
 * un utilisateur accède à une campagne si son org active est l'org
 * PROPRIÉTAIRE (`dsp_campaigns.organization_id`) OU une org LIÉE via le
 * pivot `campaign_organizations`. `super_admin` = accès global.
 *
 * Les routes retournent 404 (jamais 403) quand l'accès est refusé, pour ne
 * pas divulguer l'existence d'une campagne à une autre org (pattern de la
 * route report).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type CampaignAccess = 'ok' | 'not_found' | 'forbidden';

/** Décision pure, testable sans base. */
export function resolveCampaignAccess(
  role: string,
  userOrgId: string | null,
  ownerOrgId: string | null,
  linkedOrgIds: string[],
): boolean {
  if (role === 'super_admin') return true;
  if (!userOrgId) return false;
  if (ownerOrgId !== null && ownerOrgId === userOrgId) return true;
  return linkedOrgIds.includes(userOrgId);
}

/**
 * Vérifie l'accès en base : 2 lookups indexés (PK campagne + pivot par
 * campaign_id) en parallèle — négligeable côté I/O Nano.
 */
export async function checkCampaignAccess(
  supabase: SupabaseClient,
  profile: { role: string; organization_id: string | null },
  campaignId: string,
): Promise<CampaignAccess> {
  const [campRes, linkRes] = await Promise.all([
    supabase.from('dsp_campaigns').select('organization_id').eq('id', campaignId).maybeSingle(),
    supabase.from('campaign_organizations').select('organization_id').eq('campaign_id', campaignId),
  ]);
  if (campRes.error) console.error('[campaign-access] campagne:', campRes.error.message);
  if (linkRes.error) console.error('[campaign-access] pivot:', linkRes.error.message);
  if (!campRes.data) return 'not_found';
  const linked = ((linkRes.data ?? []) as Array<{ organization_id: string }>)
    .map((r) => r.organization_id);
  return resolveCampaignAccess(profile.role, profile.organization_id, campRes.data.organization_id, linked)
    ? 'ok'
    : 'forbidden';
}
