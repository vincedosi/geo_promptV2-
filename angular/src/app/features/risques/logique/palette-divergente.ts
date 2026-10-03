/**
 * Marche de seuils de l'échelle divergente de l'écart au plan — copie Angular
 * de `lib/campagne/palette-divergente.ts` SANS les hexadécimaux : les couleurs
 * sont les jetons `--diverge-*` (DOM) ou celles de `CouleursService` (carte).
 *
 * `trancheDivergente` est la SEULE marche de seuils : tout ce qui peint le
 * champ `ecart_pct` s'y indexe.
 */

/** Bornes en % d'écart au plan. Symétriques : la sur-pression pèse autant. */
export const BORNES_DIVERGENTES = [-50, -25, -10, 10, 25, 50] as const;

/** Les jetons CSS des sept tranches, dans l'ordre de `trancheDivergente`. */
export const RAMPE_CSS = [
  'var(--diverge-sous-3)', 'var(--diverge-sous-2)', 'var(--diverge-sous-1)',
  'var(--diverge-neutre)',
  'var(--diverge-sur-1)', 'var(--diverge-sur-2)', 'var(--diverge-sur-3)',
] as const;

export const LIBELLES_TRANCHES = [
  'moins de la moitié', 'sous-pression', 'légèrement sous',
  'conforme', 'légèrement au-dessus', 'sur-pression', 'plus de 50 % au-dessus',
] as const;

/**
 * Indice de tranche (0-6) sur l'échelle divergente à sept paliers —
 * `BORNES_DIVERGENTES` a 6 bornes, donc 7 intervalles.
 */
export function trancheDivergente(ecartPct: number): number {
  let i = 0;
  while (i < BORNES_DIVERGENTES.length && ecartPct >= BORNES_DIVERGENTES[i]) i++;
  return i;
}
