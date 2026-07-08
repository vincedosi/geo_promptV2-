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

/**
 * Accès à une stratégie de bidding : via sa campagne
 * (`bidding_strategies.campaign_id → dsp_campaigns.organization_id`).
 * Même règle owner-ou-lié + super_admin que les campagnes.
 */
export async function checkStrategyAccess(
  supabase: SupabaseClient,
  profile: { role: string; organization_id: string | null },
  strategyId: string,
): Promise<CampaignAccess> {
  const { data, error } = await supabase
    .from('bidding_strategies')
    .select('campaign_id')
    .eq('id', strategyId)
    .maybeSingle();
  if (error) console.error('[strategy-access] strategie:', error.message);
  if (!data?.campaign_id) return 'not_found';
  return checkCampaignAccess(supabase, profile, data.campaign_id as string);
}

/**
 * Décision pure d'accès à une zone custom : super_admin global, sinon l'org
 * active doit être l'org propriétaire de la zone (`custom_geo_zones.org_id`).
 * Pas de pivot pour les zones (une zone appartient à une seule org).
 */
export function resolveZoneAccess(
  role: string,
  userOrgId: string | null,
  zoneOrgId: string | null,
): boolean {
  if (role === 'super_admin') return true;
  if (!userOrgId || zoneOrgId === null) return false;
  return userOrgId === zoneOrgId;
}

/** Vérifie l'accès à une zone custom en base (1 lookup PK indexé). */
export async function checkZoneAccess(
  supabase: SupabaseClient,
  profile: { role: string; organization_id: string | null },
  zoneId: string,
): Promise<CampaignAccess> {
  const { data, error } = await supabase
    .from('custom_geo_zones')
    .select('org_id')
    .eq('id', zoneId)
    .maybeSingle();
  if (error) console.error('[zone-access] zone:', error.message);
  if (!data) return 'not_found';
  return resolveZoneAccess(profile.role, profile.organization_id, (data as { org_id: string | null }).org_id)
    ? 'ok'
    : 'forbidden';
}

/**
 * Décision pure : un utilisateur peut-il ÉCRIRE/LIRE pour une org cible passée
 * par le client (org_id d'un body/query) ? super_admin partout, sinon l'org
 * cible doit être sa propre org active. Empêche un membre d'agir « au nom »
 * d'une autre org.
 */
export function resolveOrgWriteAccess(
  role: string,
  userOrgId: string | null,
  targetOrgId: string | null,
): boolean {
  if (role === 'super_admin') return true;
  if (!userOrgId || !targetOrgId) return false;
  return userOrgId === targetOrgId;
}
