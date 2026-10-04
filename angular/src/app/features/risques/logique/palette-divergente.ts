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

/**
 * La tranche d'un INDICE de pression (100 = conforme au plan), ou -1 sans indice — la garde de `tranche`
 * (`CarteCampagne.tsx:65-66`), à employer partout où l'écart peut manquer (carte de ⑤, T17).
 *
 * ⚠ `trancheDivergente(null)` ne lève pas : `null` se compare comme 0 (`null >= -10` vaut `true`, `null >= 10` faux),
 * et un écart ABSENT tomberait en tranche 3, « conforme ». Un bassin sans plan se peindrait alors comme tenant son plan
 * — le pire mensonge possible, puisqu'il ne se distingue plus d'une réussite. (Le rapport de T2 annonçait la tranche 6 :
 * c'est 3, mesuré.)
 */
export function trancheIndice(indice: number | null | undefined): number {
  return indice == null ? -1 : trancheDivergente(indice - 100);
}
