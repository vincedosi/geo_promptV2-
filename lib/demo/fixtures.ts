/**
 * Fixtures de la campagne fictive (idempotentes, IDs stables). Réutilise l'org
 * GENESIS (Global) et la zone battle CIRFA BRETAGNE existante ; crée une campagne
 * is_demo dédiée + un plan média initial (poids égaux sur les 4 items).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEMO_CAMPAIGN_ID, DEMO_ORG_ID, DEMO_ZONE_ID, DEMO_ZONE_NAME } from '@/lib/demo/constants';

/** Crée (ou garantit) la campagne démo is_demo. Idempotent (upsert par id fixe).
 *  NOTE implémenteur : vérifier les colonnes réelles de `dsp_campaigns` avant
 *  (`SELECT column_name FROM information_schema.columns WHERE table_name='dsp_campaigns'`)
 *  et ajouter date_start/date_end/country SI le schéma les impose NOT NULL. Le set
 *  minimal ci-dessous (id, organization_id, name, is_demo) suffit au moteur. */
export async function ensureDemoCampaign(supabase: SupabaseClient): Promise<void> {
  const { data: existing, error: selErr } = await supabase.from('dsp_campaigns').select('id, is_demo').eq('id', DEMO_CAMPAIGN_ID).maybeSingle();
  if (selErr) throw selErr;
  if (existing && existing.is_demo !== true) {
    throw new Error('demo_id_collision_with_real_campaign');
  }
  const { error } = await supabase.from('dsp_campaigns').upsert({
    id: DEMO_CAMPAIGN_ID,
    organization_id: DEMO_ORG_ID,
    name: 'Démo — pilotage CIRFA (fictive)',
    is_demo: true,
    dsp_source: 'simulator',
  }, { onConflict: 'id' });
  if (error) throw error;
}

/** Récupère les items de la zone CIRFA depuis get_zone_items_export et pose un plan
 *  média initial à poids égaux. Retourne les items pour le snapshot v1. */
export async function ensureDemoPlan(
  supabase: SupabaseClient,
  callerUserId: string,
): Promise<{ items: Array<{ item_id: string; item_name: string; target_share: number; bid_weight: number }> }> {
  const { data, error } = await supabase.rpc('get_zone_items_export', {
    p_zone_id: DEMO_ZONE_ID, p_caller_user_id: callerUserId,
  }) as { data: { items: Array<{ poi_id: string; poi_name: string }> } | null; error: Error | null };
  if (error) throw error;
  const raw = data?.items ?? [];
  if (raw.length === 0) throw new Error('demo_zone_not_expandable');

  // v1 : ENCHÈRE = CIBLE. target_share = cible (fixe), bid_weight = enchère (ajustée ensuite).
  const w = Math.round((100 / raw.length) * 10) / 10;
  const share = 1 / raw.length;
  const items = raw.map(it => ({ item_id: `${DEMO_ZONE_ID}:${it.poi_id}`, item_name: it.poi_name, target_share: share, bid_weight: w }));

  // Persiste le plan média sur la campagne (geo_strategy.media_plan) — poids = enchère
  const weights: Record<string, number> = Object.fromEntries(items.map(it => [it.item_id, it.bid_weight]));
  const { data: camp, error: fetchErr } = await supabase.from('dsp_campaigns').select('geo_strategy').eq('id', DEMO_CAMPAIGN_ID).single();
  if (fetchErr) throw fetchErr;
  const existing = (camp?.geo_strategy ?? {}) as Record<string, unknown>;
  const { error: updErr } = await supabase.from('dsp_campaigns').update({
    geo_strategy: { ...existing, media_plan: { zones: [{ id: DEMO_ZONE_ID, name: DEMO_ZONE_NAME }], budget: 100000, cpm: 5, cible: 'total', weights, updated_at: new Date().toISOString() } },
  }).eq('id', DEMO_CAMPAIGN_ID);
  if (updErr) throw updErr;

  return { items };
}
