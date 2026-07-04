/**
 * Helpers du contrôleur démo — garde is_demo, création de snapshot périodé,
 * simulation d'une période, purge. Toute écriture exige is_demo=true.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { simulateDelivery, type SimItem } from '@/lib/demo/simulator';
import { DEMO_CAMPAIGN_ID, DEMO_ZONE_ID, DEMO_ZONE_NAME, DEMO_SEED, TOTAL_VOLUME, SIM_GAIN, SIM_NOISE, periodBounds } from '@/lib/demo/constants';

/** Garde dure : refuse d'agir sur une campagne non-démo. */
export async function assertDemo(supabase: SupabaseClient, campaignId: string): Promise<void> {
  const { data } = await supabase.from('dsp_campaigns').select('is_demo').eq('id', campaignId).single();
  if (!data?.is_demo) throw new Error('not_a_demo_campaign');
}

/** Dernière version de snapshot de la campagne démo (0 si aucune). */
export async function latestVersion(supabase: SupabaseClient): Promise<number> {
  const { data } = await supabase.from('campaign_plan_snapshot').select('version')
    .eq('campaign_id', DEMO_CAMPAIGN_ID).order('version', { ascending: false }).limit(1);
  return (data?.[0]?.version as number | undefined) ?? 0;
}

/** Crée un snapshot périodé pour la campagne démo. Chaque item porte SA CIBLE (fixe) et SON
 *  ENCHÈRE (courante) : expected_share = target_share (cible), item_weight = bid_weight (enchère). */
export async function createPeriodSnapshot(
  supabase: SupabaseClient, callerUserId: string,
  items: Array<{ item_id: string; item_name: string; target_share: number; bid_weight: number }>, period: number,
): Promise<number> {
  const version = (await latestVersion(supabase)) + 1;
  const { start, end } = periodBounds(period);
  const { data, error: rpcErr } = await supabase.rpc('get_zone_items_export', {
    p_zone_id: DEMO_ZONE_ID, p_caller_user_id: callerUserId,
  }) as { data: { items: Array<{ poi_id: string; cps: string[] }> } | null; error: { message: string } | null };
  if (rpcErr) { console.warn('[demo/createPeriodSnapshot] get_zone_items_export', rpcErr.message); throw new Error(rpcErr.message); }
  const cpsByPoi = new Map((data?.items ?? []).map(it => [it.poi_id, it.cps]));

  // Items retenus = ceux expansables (cps non vide). La cible est renormalisée à 1 sur
  // ces seuls items retenus (sinon Σ expected_share < 1 dans la zone si un item est exclu).
  const kept = items
    .map(it => ({ it, cps: cpsByPoi.get(it.item_id.slice(DEMO_ZONE_ID.length + 1)) ?? [] }))
    .filter(x => x.cps.length > 0);
  const totalTarget = kept.reduce((s, x) => s + x.it.target_share, 0) || 1;

  const rows: Array<Record<string, unknown>> = [];
  for (const { it, cps } of kept) {
    const expected_share = it.target_share / totalTarget; // CIBLE renormalisée sur les items retenus
    for (const cp of cps) {
      rows.push({
        campaign_id: DEMO_CAMPAIGN_ID, version, created_by: callerUserId, dsp: 'dv360',
        budget: 100000, cpm: 5, cible: 'total', zone_id: DEMO_ZONE_ID, zone_name: DEMO_ZONE_NAME,
        item_id: it.item_id, item_name: it.item_name,
        item_weight: it.bid_weight,  // ENCHÈRE (change par version)
        expected_share,              // CIBLE renormalisée (identique sur toutes les versions)
        postal_code: cp, period_start: start, period_end: end,
      });
    }
  }
  if (rows.length === 0) throw new Error('no_expandable_items');
  for (let i = 0; i < rows.length; i += 50) {
    const { error } = await supabase.from('campaign_plan_snapshot').insert(rows.slice(i, i + 50));
    if (error) { await supabase.from('campaign_plan_snapshot').delete().eq('campaign_id', DEMO_CAMPAIGN_ID).eq('version', version); throw error; }
  }
  return version;
}

/** Simule la délivrance de la période courante (dernière version) et l'écrit (idempotent). */
export async function simulateCurrentPeriod(supabase: SupabaseClient): Promise<{ rows: number }> {
  const version = await latestVersion(supabase);
  if (version === 0) throw new Error('no_snapshot');

  const { data: snap } = await supabase.from('campaign_plan_snapshot')
    .select('zone_id, item_id, item_weight, postal_code, period_start')
    .eq('campaign_id', DEMO_CAMPAIGN_ID).eq('version', version);
  const rows = snap ?? [];
  if (rows.length === 0) throw new Error('empty_snapshot');
  const period = version; // 1 version ↔ 1 période dans la démo
  const periodStart = rows[0].period_start as string;

  // Reconstruire les items (item → cps + ENCHÈRE item_weight). Le simulateur est piloté
  // par l'enchère normalisée (bid_share), PAS par la cible.
  const byItem = new Map<string, { zone_id: string; item_id: string; item_weight: number; cps: string[] }>();
  const cps = new Set<string>();
  for (const r of rows) {
    cps.add(r.postal_code as string);
    const it = byItem.get(r.item_id as string) ?? { zone_id: r.zone_id as string, item_id: r.item_id as string, item_weight: r.item_weight as number, cps: [] };
    it.cps.push(r.postal_code as string);
    byItem.set(r.item_id as string, it);
  }
  const totalWeight = Array.from(byItem.values()).reduce((s, it) => s + it.item_weight, 0) || 1;
  const simItems: SimItem[] = Array.from(byItem.values()).map(it => ({
    zone_id: it.zone_id, item_id: it.item_id, bid_share: it.item_weight / totalWeight, cps: it.cps,
  }));

  // Audience par CP
  const { data: refs } = await supabase.from('ref_codes_postaux')
    .select('code_postal, pop_total').in('code_postal', Array.from(cps));
  const audienceByCp: Record<string, number> = Object.fromEntries((refs ?? []).map(r => [r.code_postal as string, Number(r.pop_total) || 0]));

  const delivery = simulateDelivery({
    items: simItems, audienceByCp, seed: DEMO_SEED, period,
    totalVolume: TOTAL_VOLUME, gain: SIM_GAIN, noise: SIM_NOISE,
  });

  // Idempotence : purge la délivrance de cette période avant réinsertion
  const { end } = periodBounds(period);
  await supabase.from('dsp_campaign_data').delete()
    .eq('campaign_id', DEMO_CAMPAIGN_ID).gte('date', periodStart).lt('date', end);

  const dataRows = delivery.map(d => ({
    campaign_id: DEMO_CAMPAIGN_ID, country: 'France', dsp_source: 'simulator', media: 'sim',
    date: periodStart, postal_code: d.postal_code,
    impressions: d.impressions, clicks: d.clicks, spend: d.spend, metrics: {},
  }));
  for (let i = 0; i < dataRows.length; i += 50) {
    const { error } = await supabase.from('dsp_campaign_data').insert(dataRows.slice(i, i + 50));
    if (error) throw error;
  }
  return { rows: dataRows.length };
}

/** Purge délivrance + snapshots de la campagne démo. */
export async function purgeDemo(supabase: SupabaseClient): Promise<void> {
  await supabase.from('dsp_campaign_data').delete().eq('campaign_id', DEMO_CAMPAIGN_ID);
  await supabase.from('campaign_plan_snapshot').delete().eq('campaign_id', DEMO_CAMPAIGN_ID);
}
