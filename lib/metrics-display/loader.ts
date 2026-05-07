/**
 * MAGELIAN — Chargement de `dsp_metrics_registry` + cache mémoire.
 *
 * Pattern Nano-friendly : 1 round-trip DB par process toutes les 5 minutes,
 * pas par campagne ni par requête. Le registry est petit (≤ 30 lignes
 * prévisibles) donc on cache tout in-memory.
 */

import { createAdminClient } from '@/lib/auth';
import type { MetricDescriptor, OptimizationDirection } from './types';

const TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  list: MetricDescriptor[];
  byField: Map<string, MetricDescriptor>;
  fetchedAt: number;
}

let cache: CacheEntry | null = null;

interface RegistryRow {
  field: string;
  display_name: string;
  display_name_fr: string | null;
  unit: string | null;
  description: string | null;
  is_core: boolean;
  is_kpi_eligible: boolean;
  is_legacy: boolean;
  optimization_direction: OptimizationDirection | null;
  display_order: number;
}

function rowToDescriptor(r: RegistryRow): MetricDescriptor {
  return {
    field: r.field,
    displayName: r.display_name,
    displayNameFr: r.display_name_fr,
    unit: r.unit,
    description: r.description,
    isCore: r.is_core,
    isKpiEligible: r.is_kpi_eligible,
    isLegacy: r.is_legacy,
    optimizationDirection: r.optimization_direction,
    displayOrder: r.display_order,
  };
}

/**
 * Charge l'ensemble des métriques actives, ordonnées par `display_order`.
 * Cache 5 minutes.
 */
export async function loadMetricsRegistry(): Promise<MetricDescriptor[]> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < TTL_MS) return cache.list;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('dsp_metrics_registry')
    .select(
      'field, display_name, display_name_fr, unit, description, is_core, is_kpi_eligible, is_legacy, optimization_direction, display_order',
    )
    .eq('is_enabled', true)
    .order('display_order', { ascending: true });

  if (error) {
    throw new Error(`[metrics-display/loader] ${error.message}`);
  }

  const list = ((data ?? []) as RegistryRow[]).map(rowToDescriptor);
  const byField = new Map(list.map((m) => [m.field, m]));
  cache = { list, byField, fetchedAt: now };
  return list;
}

/** Lookup d'une métrique par `field`. Retourne null si inexistante. */
export async function getMetric(field: string): Promise<MetricDescriptor | null> {
  if (!cache || Date.now() - cache.fetchedAt >= TTL_MS) {
    await loadMetricsRegistry();
  }
  return cache?.byField.get(field) ?? null;
}

/** Reset cache (tests, après INSERT/UPDATE manuel sur le registry). */
export function invalidateMetricsCache(): void {
  cache = null;
}
