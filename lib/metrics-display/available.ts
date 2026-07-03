/**
 * MAGELIAN — Détection des KPIs réellement disponibles pour une campagne.
 *
 * Utilise la RPC `get_campaign_available_metrics(uuid)` (chantier A3) :
 * une seule requête DB qui parcourt tout le registry et fait un EXISTS
 * adapté selon `is_core` (colonne native vs metrics JSONB).
 */

import { createAdminClient } from '@/lib/auth';
import { loadMetricsRegistry } from './loader';
import type { CampaignAvailableMetrics, MetricDescriptor } from './types';

interface RpcRow {
  field: string;
  has_data: boolean;
}

/**
 * Retourne les métriques split en `available` (has_data=true) et `empty`
 * (has_data=false). Order préservé du registry (display_order ASC).
 */
export async function detectAvailableMetrics(
  campaignId: string,
): Promise<CampaignAvailableMetrics> {
  const supabase = createAdminClient();
  const [registry, rpc] = await Promise.all([
    loadMetricsRegistry(),
    supabase.rpc('get_campaign_available_metrics', { p_campaign_id: campaignId }),
  ]);

  if (rpc.error) {
    throw new Error(`[metrics-display/available] ${rpc.error.message}`);
  }

  const hasData = new Map<string, boolean>(
    ((rpc.data ?? []) as RpcRow[]).map((r) => [r.field, !!r.has_data]),
  );

  const available: MetricDescriptor[] = [];
  const empty: MetricDescriptor[] = [];
  for (const m of registry) {
    if (hasData.get(m.field)) available.push(m);
    else empty.push(m);
  }
  return { available, empty };
}
