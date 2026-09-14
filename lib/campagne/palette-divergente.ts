/**
 * Échelle divergente de l'écart au plan.
 *
 * Deux consommateurs, deux formats :
 *  - le DOM lit les tokens `--diverge-*` de globals.css ;
 *  - MapLibre ne résout PAS `var()` dans `paint` et doit recevoir des hex
 *    littéraux — d'où la duplication assumée ci-dessous. Elle est verrouillée
 *    par tests/unit/campagne/palette-divergente.test.ts.
 */

/** Bornes en % d'écart au plan. Symétriques : la sur-pression pèse autant. */
export const BORNES_DIVERGENTES = [-50, -25, -10, 10, 25, 50] as const

export const RAMPE_MAPLIBRE: Record<'dark' | 'light', string[]> = {
  dark:  ['#c2410c', '#ea7c4a', '#f0b48c', '#4a4a4a', '#8fb8d8', '#4a86b8', '#1f5c8f'],
  light: ['#9a2f08', '#cc5f27', '#e8a878', '#c6d2cf', '#7ba7cc', '#2f6fa3', '#14496f'],
}

export const LIBELLES_TRANCHES = [
  'moins de la moitié', 'sous-pression', 'légèrement sous',
  'conforme', 'légèrement au-dessus', 'sur-pression', 'plus de 50 % au-dessus',
] as const

export function couleurDivergente(ecartPct: number, theme: 'dark' | 'light'): string {
  const rampe = RAMPE_MAPLIBRE[theme]
  let i = 0
  while (i < BORNES_DIVERGENTES.length && ecartPct >= BORNES_DIVERGENTES[i]) i++
  return rampe[i]
}
