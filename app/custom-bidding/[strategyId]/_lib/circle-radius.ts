/**
 * Expression `circle-radius` des bulles de volume de la carte de pilotage.
 *
 * MapLibre exige des entrees **strictement croissantes** dans un
 * `interpolate` : si deux bornes sont egales, l'expression entiere est
 * rejetee sans exception JS et le rayon reste a sa valeur initiale (0) —
 * les bulles disparaissent. Les bornes sont donc derivees d'une base
 * toujours strictement positive, jamais d'un plancher qui pourrait les
 * faire coincider.
 */

/** Fractions du volume maximal auxquelles les paliers sont places. */
const VOLUME_STOPS = [0.05, 0.3, 0.6, 1] as const;

/** Fractions du rayon maximal associees, dans le meme ordre. */
const RADIUS_STOPS = [0.2, 0.45, 0.7, 1] as const;

/**
 * Construit l'expression du rayon des bulles pour un volume maximal donne.
 *
 * @param maxImpressions Volume le plus eleve de la serie affichee. Une valeur
 *   nulle, negative ou non finie (aucune donnee chargee) retombe sur 1 :
 *   l'echelle est degeneree mais l'expression reste valide.
 * @param maxRadius Rayon en pixels atteint au volume maximal — depend de la
 *   granularite (plus petit en code postal, ou les points sont nombreux).
 */
export function buildCircleRadiusExpression(
  maxImpressions: number,
  maxRadius: number,
): unknown[] {
  const base =
    Number.isFinite(maxImpressions) && maxImpressions > 0 ? maxImpressions : 1;

  const stops = VOLUME_STOPS.flatMap((fraction, i) => [
    base * fraction,
    i === RADIUS_STOPS.length - 1
      ? maxRadius
      : Math.round(maxRadius * RADIUS_STOPS[i]),
  ]);

  return ['interpolate', ['linear'], ['get', 'impressions'], 0, 0, ...stops];
}
