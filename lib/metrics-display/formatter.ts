/**
 * GEOMATIK — Formatage d'une valeur de métrique selon son `unit`.
 *
 * Les unités sont stockées en TEXT côté DB (`dsp_metrics_registry.unit`).
 * Toutes les inconnues tombent en formatage générique number.
 */

import type { MetricDescriptor } from './types';

const NF_INT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const NF_EUR = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 2,
});
const NF_PCT = new Intl.NumberFormat('fr-FR', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formate une valeur numérique pour affichage.
 * Retourne '—' si null/undefined/NaN.
 */
export function formatMetricValue(
  value: number | null | undefined,
  metric: MetricDescriptor,
): string {
  if (value === null || value === undefined || !isFinite(value)) return '—';

  switch (metric.unit) {
    case 'count':
      return NF_INT.format(value);
    case 'currency_eur':
      return NF_EUR.format(value);
    case 'rate':
    case 'percent':
      // Convention : si la valeur est déjà ∈ [0,1] on l'affiche en %.
      // Sinon on suppose qu'elle est déjà ×100 et on divise.
      return NF_PCT.format(value > 1 ? value / 100 : value);
    case 'seconds':
      return `${value.toFixed(1)} s`;
    default:
      return Number.isInteger(value) ? NF_INT.format(value) : value.toFixed(2);
  }
}

/** Label affiché : `display_name_fr` si dispo, sinon `display_name`. */
export function metricLabel(metric: MetricDescriptor): string {
  return metric.displayNameFr ?? metric.displayName;
}
