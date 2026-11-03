import { formaterNombre } from '../../../../core/format/nombre';

/*
 * ⑤ Jeu de zones — la population d'une forme achetée telle quelle, dite à l'écran (revue T6, I-3). À part de
 * `ecran.ts`, arrivé au plafond de 400 lignes. PUR, sans import d'Angular.
 */

/**
 * Revue T6 (I-3, ARB-3) : la population d'une maille exacte — « 1 234 habitants carroyés », ou, sur un territoire non
 * carroyé (`inconnue`), « population inconnue (territoire non carroyé) », jamais « 0 habitant » ; en partie carroyé, la
 * part connue et la réserve. `libelle` : « habitants carroyés » (ou « … de la cible »).
 */
export function textePopulationForme(population: number, inconnue: boolean, libelle: string): string {
  if (!inconnue) return `${formaterNombre(population)} ${libelle}`;
  return population > 0 ? `${formaterNombre(population)} ${libelle}, population en partie inconnue (territoire non carroyé)`
    : 'population inconnue (territoire non carroyé)';
}
