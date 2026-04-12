export const PALETTES = [
  { id: 'teal',    label: 'Teal',    stops: ['#0a0a0a','#16537e','#1e8a7a','#4ecdc4','#7eddd5','#f7fff7'] },
  { id: 'bleu',    label: 'Bleu',    stops: ['#F7FBFF','#C6DBEF','#9ECAE1','#4292C6','#2171B5','#08306B'] },
  { id: 'vert',    label: 'Vert',    stops: ['#F7FCF5','#C7E9C0','#74C476','#41AB5D','#238B45','#00441B'] },
  { id: 'chaleur', label: 'Chaleur', stops: ['#FAEEDA','#FAC775','#EF9F27','#D85A30','#993C1D','#501313'] },
  { id: 'rouge',   label: 'Rouge',   stops: ['#FFF5F0','#FEE0D2','#FCBBA1','#FC9272','#DE2D26','#A50F15'] },
  { id: 'turbo',   label: 'Turbo',   stops: ['#30123b','#4675ed','#1bcfd4','#61fc6c','#f6a91b','#c42503'] },
  { id: 'plasma',  label: 'Plasma',  stops: ['#0d0887','#6a00a8','#b12a90','#e16462','#fca636','#f0f921'] },
];

export const RATIO_PALETTE = {
  id: 'ratio',
  label: 'Ratio',
  stops: ['#b2182b','#ef8a62','#fddbc7','#f7f7f7','#d1e5f0','#67a9cf','#2166ac'],
};

export interface Percentiles {
  p10: number; p25: number; p50: number; p75: number; p90: number; max: number;
}

export function computePercentiles(values: number[]): Percentiles {
  if (values.length === 0) return { p10: 0, p25: 1, p50: 10, p75: 100, p90: 1000, max: 10000 };
  const sorted = [...values].filter(v => v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return { p10: 0, p25: 1, p50: 10, p75: 100, p90: 1000, max: 10000 };
  const pct = (p: number) => sorted[Math.floor(p * (sorted.length - 1))];
  return { p10: pct(0.1), p25: pct(0.25), p50: pct(0.5), p75: pct(0.75), p90: pct(0.9), max: sorted[sorted.length - 1] };
}

export function buildFillExpression(
  attribute: string,
  stops: string[],
  percentiles: Percentiles,
  inverted: boolean
): unknown[] {
  const s = inverted ? [...stops].reverse() : stops;
  const pts = [percentiles.p10, percentiles.p25, percentiles.p50, percentiles.p75, percentiles.p90, percentiles.max];
  const pairs: (string | number)[] = [];
  let prev = -Infinity;
  for (let i = 0; i < Math.min(s.length, pts.length); i++) {
    if (pts[i] > prev) { pairs.push(pts[i], s[i]); prev = pts[i]; }
  }
  if (pairs.length < 4) { pairs.push(1, s[0], 1000, s[s.length - 1]); }
  return [
    'case',
    ['==', ['to-number', ['get', attribute], 0], 0], '#1a1a1a',
    ['interpolate', ['linear'], ['to-number', ['get', attribute], 0], ...pairs],
  ];
}
