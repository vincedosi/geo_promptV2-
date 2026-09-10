/**
 * @file lib/carreaux/expressions.ts
 *
 * Frontieres de classes partagees par la couleur peinte, la legende et le
 * filtre par palier.
 *
 * Avant : la couleur etait un `interpolate` continu dont les 6 arrets etaient
 * poses a `k/5` de l'etendue, tandis que legende et filtre decoupaient en
 * `k/6`. Une pastille pouvait donc annoncer une teinte que la carte n'employait
 * pas dans cette tranche. Un `step` sur CES bornes rend l'egalite vraie par
 * construction.
 */
import { palierEchelle, type BornesEchelle } from '@/lib/carreaux/bornes';

/**
 * Les `nPaliers - 1` frontieres internes, dans l'ordre croissant.
 *
 * @returns pour 6 classes, les 5 valeurs qui les separent — exactement les
 *          `max` des paliers 0 a 4, donc les `min` des paliers 1 a 5.
 */
export function bornesInternes(bornes: BornesEchelle, nPaliers: number): number[] {
  return Array.from({ length: nPaliers - 1 }, (_, k) => palierEchelle(bornes, k, nPaliers).max);
}
