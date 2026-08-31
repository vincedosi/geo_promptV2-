/**
 * MAGELIAN — agregation des series meteo sur une periode.
 *
 * `aggregatePeriod()` applique a une serie la fonction propre a la variable
 * (cf. METEO_AGGREGATION) apres avoir ecarte les valeurs nulles ou NaN :
 * cumuler des precipitations et moyenner une temperature ne sont pas la
 * meme operation.
 */
import type { MeteoStats, MeteoVariable } from './types';
import { METEO_AGGREGATION, METEO_UNIT } from './types';

export function aggregatePeriod(
  values: (number | null | undefined)[],
  variable: MeteoVariable,
): number {
  const clean = values.filter(
    (v): v is number => typeof v === 'number' && !Number.isNaN(v),
  );
  if (clean.length === 0) return 0;
  const fn = METEO_AGGREGATION[variable];
  if (fn === 'sum') return clean.reduce((a, b) => a + b, 0);
  if (fn === 'mean') return clean.reduce((a, b) => a + b, 0) / clean.length;
  if (fn === 'max') return Math.max(...clean);
  return 0;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

export function computeStats(
  values: number[],
  variable: MeteoVariable,
): MeteoStats {
  const unit = METEO_UNIT[variable];
  if (values.length === 0) {
    return { min: 0, max: 0, mean: 0, p20: 0, p40: 0, p60: 0, p80: 0, unit };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sum / values.length,
    p20: percentile(sorted, 20),
    p40: percentile(sorted, 40),
    p60: percentile(sorted, 60),
    p80: percentile(sorted, 80),
    unit,
  };
}

const LABELS: Record<MeteoVariable, [string, string, string, string, string]> = {
  precipitation: ['sec', 'faible pluie', 'modéré', 'forte pluie', 'très forte'],
  temperature_2m: ['froid', 'frais', 'doux', 'tiède', 'chaud'],
  windspeed_10m: ['calme', 'brise', 'modéré', 'fort', 'tempête'],
  sunshine_duration: [
    'couvert',
    'peu ensoleillé',
    'mitigé',
    'ensoleillé',
    'très ensoleillé',
  ],
};

export function qualitativeLabel(
  value: number,
  stats: MeteoStats,
  variable: MeteoVariable,
): string {
  const labels = LABELS[variable];
  if (value < stats.p20) return labels[0];
  if (value < stats.p40) return labels[1];
  if (value < stats.p60) return labels[2];
  if (value < stats.p80) return labels[3];
  return labels[4];
}
