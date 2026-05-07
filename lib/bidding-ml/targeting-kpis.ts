/**
 * KPI de ciblage : mesurent à quel point la diffusion (impressions/clics/leads)
 * est concentrée sur les zones cibles définies par la pondération INSEE.
 *
 * Cas d'usage : campagne abstention pondérée par `taux_abstention`.
 *   • Avant MAGELIAN : la diffusion suit l'inventaire DSP, pas la cible.
 *   • Après MAGELIAN : la diffusion se concentre sur le top-quartile
 *     d'abstention.
 *
 * Toutes les fonctions sont pures, opèrent sur du JS pur, pas de dépendance.
 */

import type { ComparisonRow } from './comparison';
import { aggregateByZone } from './comparison';
import { metricFields, type PrimaryMetric } from './metric-labels';

const num = (v: number | string | null | undefined): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
};

/**
 * Retourne le seuil correspondant au quartile demandé (Q3 = top 25%).
 * Retourne null si la liste est vide.
 */
export function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

/**
 * Identifie les codes postaux "cibles" : ceux dont la valeur INSEE est
 * dans le top-quartile (si highIsTarget) ou bottom-quartile (sinon).
 */
export function selectTargetZones(
  insseValues: Record<string, number>,
  highIsTarget: boolean,
): { targetSet: Set<string>; threshold: number | null } {
  const values = Object.values(insseValues).filter(Number.isFinite);
  if (values.length === 0) return { targetSet: new Set(), threshold: null };
  const threshold = quantile(values, highIsTarget ? 0.75 : 0.25);
  if (threshold === null) return { targetSet: new Set(), threshold: null };
  const targetSet = new Set<string>();
  for (const [cp, v] of Object.entries(insseValues)) {
    if (highIsTarget ? v >= threshold : v <= threshold) {
      targetSet.add(cp);
    }
  }
  return { targetSet, threshold };
}

export interface TargetingKpis {
  /** Métrique sur laquelle on calcule (impressions par défaut pour reach). */
  metric: PrimaryMetric;
  /** Total métrique servie dans les zones cibles (réel). */
  on_target_real: number;
  /** Total métrique servie dans les zones cibles (simulé / avec algo). */
  on_target_sim: number;
  /** Total métrique servie hors cible (réel). */
  off_target_real: number;
  /** Total métrique servie hors cible (simulé). */
  off_target_sim: number;
  /** Total métrique réel (toutes zones). */
  total_real: number;
  /** Total métrique simulé (toutes zones). */
  total_sim: number;
  /** Part de la métrique servie sur cible avant algo (0..1). */
  on_target_share_real: number;
  /** Part de la métrique servie sur cible après algo (0..1). */
  on_target_share_sim: number;
  /** Delta absolu de la part sur cible (en points de %). */
  share_delta_pp: number;
  /** Lift relatif sur le volume sur cible (((sim - real) / real) * 100). */
  on_target_lift_pct: number;
  /** Corrélation Pearson entre la métrique et la valeur INSEE par zone (réel). */
  correlation_real: number;
  /** Corrélation Pearson entre la métrique et la valeur INSEE par zone (sim). */
  correlation_sim: number;
  /** Volume métrique "redéployé" hors zones bas-cible (max(0, off_target_real - off_target_sim)). */
  reallocated_from_off_target: number;
  /** Spend total réel (€). */
  total_spend_real: number;
  /** Spend total simulé (€). */
  total_spend_sim: number;
  /** Δ spend (sim - réel). Doit rester proche de 0 (iso-budget). */
  spend_delta_eur: number;
  /** Nombre de zones cibles. */
  n_target_zones: number;
  /** Nombre total de zones servies. */
  n_zones: number;
  /** Nombre de jours dans le run. */
  n_days: number;
}

function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const ax = xs[i] - mx, ay = ys[i] - my;
    num += ax * ay;
    dx2 += ax * ax;
    dy2 += ay * ay;
  }
  const den = Math.sqrt(dx2 * dy2);
  return den > 0 ? num / den : 0;
}

export function computeTargetingKpis(
  rows: ComparisonRow[],
  insseValues: Record<string, number>,
  metric: PrimaryMetric,
  highIsTarget: boolean,
): TargetingKpis {
  const { targetSet } = selectTargetZones(insseValues, highIsTarget);
  const fields = metricFields(metric);
  const days = new Set<string>();
  let on_target_real = 0, on_target_sim = 0;
  let off_target_real = 0, off_target_sim = 0;
  let total_real = 0, total_sim = 0;
  let total_spend_real = 0, total_spend_sim = 0;

  for (const r of rows) {
    days.add(r.date);
    const cp = r.postal_code;
    const real = num((r as unknown as Record<string, unknown>)[fields.real] as number | string);
    const sim = num((r as unknown as Record<string, unknown>)[fields.sim] as number | string);
    total_real += real;
    total_sim += sim;
    total_spend_real += num(r.spend_real);
    total_spend_sim += num(r.spend_sim);
    if (targetSet.has(cp)) {
      on_target_real += real;
      on_target_sim += sim;
    } else {
      off_target_real += real;
      off_target_sim += sim;
    }
  }

  const zones = aggregateByZone(rows);
  const xs_real: number[] = [];
  const ys: number[] = [];
  const xs_sim: number[] = [];
  for (const z of zones) {
    const v = insseValues[z.postal_code];
    if (!Number.isFinite(v)) continue;
    const valReal = num((z as unknown as Record<string, unknown>)[fields.real] as number | string);
    const valSim = num((z as unknown as Record<string, unknown>)[fields.sim] as number | string);
    xs_real.push(valReal);
    xs_sim.push(valSim);
    ys.push(v);
  }
  const correlation_real = pearson(xs_real, ys);
  const correlation_sim = pearson(xs_sim, ys);

  const on_target_share_real = total_real > 0 ? on_target_real / total_real : 0;
  const on_target_share_sim = total_sim > 0 ? on_target_sim / total_sim : 0;
  const share_delta_pp = (on_target_share_sim - on_target_share_real) * 100;
  const on_target_lift_pct = on_target_real > 0
    ? ((on_target_sim - on_target_real) / on_target_real) * 100
    : 0;
  const reallocated_from_off_target = Math.max(0, off_target_real - off_target_sim);

  return {
    metric,
    on_target_real,
    on_target_sim,
    off_target_real,
    off_target_sim,
    total_real,
    total_sim,
    on_target_share_real,
    on_target_share_sim,
    share_delta_pp,
    on_target_lift_pct,
    correlation_real,
    correlation_sim,
    reallocated_from_off_target,
    total_spend_real,
    total_spend_sim,
    spend_delta_eur: total_spend_sim - total_spend_real,
    n_target_zones: targetSet.size,
    n_zones: zones.length,
    n_days: days.size,
  };
}
