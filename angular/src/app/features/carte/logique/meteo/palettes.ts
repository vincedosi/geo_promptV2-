/**
 * Copie Angular (lot 4, P6) VERBATIM de `lib/meteo/palettes.ts` (imports relatifs seuls changes),
 * verrouillee par tests/unit/angular/carte-couches-paritaire.test.ts (gel P5 etendu a /map).
 * Ne pas corriger un defaut ici sans le corriger dans React.
 */
/**
 * MAGELIAN — palettes de choroplethe meteo.
 *
 * Cinq paliers par variable, du plus faible au plus eleve. Temperature et
 * vent utilisent une echelle divergente (froid -> chaud), precipitations et
 * ensoleillement une echelle sequentielle.
 */
import type { MeteoStats, MeteoVariable } from './types';

export const METEO_PALETTES: Record<
  MeteoVariable,
  [string, string, string, string, string]
> = {
  precipitation: ['#f7fbff', '#6baed6', '#2171b5', '#08519c', '#08306b'],
  temperature_2m: ['#2166ac', '#67a9cf', '#fddbc7', '#ef8a62', '#b2182b'],
  windspeed_10m: ['#f7fcf5', '#74c476', '#238b45', '#e6550d', '#a63603'],
  sunshine_duration: ['#525252', '#969696', '#fdd49e', '#fdbb84', '#e6550d'],
};

export function buildColorExpression(
  variable: MeteoVariable,
  stats: MeteoStats,
  property: string = 'weather_value',
): unknown[] {
  const palette = METEO_PALETTES[variable];
  const { min, max } = stats;
  const range = max - min;
  const step = range === 0 ? 0 : range / (palette.length - 1);
  const stops: (number | string)[] = [];
  for (let i = 0; i < palette.length; i++) {
    stops.push(min + step * i, palette[i]);
  }
  // Garantir des stops strictement croissants si range = 0 (éviter MapLibre error)
  if (range === 0) {
    return ['literal', palette[Math.floor(palette.length / 2)]];
  }
  return ['interpolate', ['linear'], ['get', property], ...stops];
}
