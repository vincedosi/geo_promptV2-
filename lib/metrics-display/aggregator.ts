/**
 * GEOMATIK — Agrégation de valeurs par campagne / zone pour un KPI donné.
 *
 * V1 du chantier A3 : SUM uniquement (cohérent avec le comportement legacy
 * pour `tracked_ads`). Les KPIs dérivés (CTR = clicks/impressions,
 * CPL = spend/leads) sont calculés au niveau composant à partir de plusieurs
 * agrégats, pas via cette fonction.
 *
 * Si `dsp_metrics_registry` gagne plus tard un champ `aggregation_function`,
 * étendre ce module pour supporter `avg` et `calculated`.
 */

import { createAdminClient } from '@/lib/auth';
import type { MetricDescriptor } from './types';

/**
 * Somme des valeurs du KPI pour une campagne entière.
 * - `is_core` true → SUM(<colonne native>)
 * - `is_core` false → SUM((metrics->>'<field>')::numeric)
 *
 * Retourne `null` si aucune ligne ou si la métrique n'a aucune valeur.
 */
export async function aggregateCampaignMetric(
  campaignId: string,
  metric: MetricDescriptor,
): Promise<number | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('aggregate_campaign_metric', {
    p_campaign_id: campaignId,
    p_metric_field: metric.field,
    p_is_core: metric.isCore,
  });
  if (error) {
    throw new Error(`[metrics-display/aggregator] ${error.message}`);
  }
  // RPC returns numeric → JS number ou null.
  if (data === null || data === undefined) return null;
  const n = typeof data === 'number' ? data : Number(data);
  return isFinite(n) ? n : null;
}
