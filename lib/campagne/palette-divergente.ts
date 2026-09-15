/**
 * Échelle divergente de l'écart au plan.
 *
 * Deux consommateurs, deux formats :
 *  - le DOM lit les tokens `--diverge-*` de globals.css (`RAMPE_CSS`
 *    ci-dessous — bascule de thème seule, via la cascade CSS, aucun
 *    `useTheme()` requis) ;
 *  - MapLibre ne résout PAS `var()` dans `paint` et doit recevoir des hex
 *    littéraux (`RAMPE_MAPLIBRE`, par thème) — d'où la duplication assumée
 *    ci-dessous. Elle est verrouillée par
 *    tests/unit/campagne/palette-divergente.test.ts (correspondance hex) et
 *    tests/unit/campagne/palette-divergente-css.test.ts (correspondance avec
 *    `app/globals.css`).
 *
 * `trancheDivergente` est la SEULE marche de seuils (`BORNES_DIVERGENTES`) :
 * `couleurDivergente` délègue plutôt que de la dupliquer, et tout composant
 * DOM qui peint le même champ `ecart_pct` doit faire de même (ruling T14-2 —
 * `TableauDeregles.tsx` avait réinventé un schéma de gravité asymétrique à
 * trois teintes plutôt que de réutiliser cette échelle à sept paliers).
 */

/** Bornes en % d'écart au plan. Symétriques : la sur-pression pèse autant. */
export const BORNES_DIVERGENTES = [-50, -25, -10, 10, 25, 50] as const

export const RAMPE_MAPLIBRE: Record<'dark' | 'light', string[]> = {
  dark:  ['#c2410c', '#ea7c4a', '#f0b48c', '#4a4a4a', '#8fb8d8', '#4a86b8', '#1f5c8f'],
  light: ['#9a2f08', '#cc5f27', '#e8a878', '#c6d2cf', '#7ba7cc', '#2f6fa3', '#14496f'],
}

/**
 * Miroir CSS de `RAMPE_MAPLIBRE`, pour les composants DOM ordinaires (pas
 * MapLibre) qui peignent le MÊME champ `ecart_pct` avec la MÊME échelle à
 * sept paliers — jamais une échelle recopiée à la main. Chaque entrée
 * correspond, dans l'ordre, à un token `--diverge-*` de `app/globals.css`
 * (présent dans `:root` ET `html.light` — voir `palette-divergente-css.test.ts`) ;
 * la bascule de thème est automatique via la cascade, contrairement à
 * `RAMPE_MAPLIBRE` qui doit être indexée par thème parce que MapLibre ne
 * résout pas `var()`.
 */
export const RAMPE_CSS = [
  'var(--diverge-sous-3)', 'var(--diverge-sous-2)', 'var(--diverge-sous-1)',
  'var(--diverge-neutre)',
  'var(--diverge-sur-1)', 'var(--diverge-sur-2)', 'var(--diverge-sur-3)',
] as const

export const LIBELLES_TRANCHES = [
  'moins de la moitié', 'sous-pression', 'légèrement sous',
  'conforme', 'légèrement au-dessus', 'sur-pression', 'plus de 50 % au-dessus',
] as const

/**
 * Indice de tranche (0-6) sur l'échelle divergente à sept paliers —
 * `BORNES_DIVERGENTES` a 6 bornes, donc 7 intervalles. Source unique de la
 * marche de seuils : `couleurDivergente` et `RAMPE_CSS` s'indexent tous les
 * deux dessus plutôt que de la refaire chacun à leur façon.
 */
export function trancheDivergente(ecartPct: number): number {
  let i = 0
  while (i < BORNES_DIVERGENTES.length && ecartPct >= BORNES_DIVERGENTES[i]) i++
  return i
}

export function couleurDivergente(ecartPct: number, theme: 'dark' | 'light'): string {
  return RAMPE_MAPLIBRE[theme][trancheDivergente(ecartPct)]
}
