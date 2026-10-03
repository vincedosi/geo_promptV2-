/**
 * Opacité par bande 1 à 4 (`OPACITE_BANDE`, lib/carte/palette-zones-risque.ts) : la teinte dit le niveau, l'opacité la
 * distance. Source UNIQUE : la couche de zones de la carte et la légende la lisent ici, pour ne pas dériver.
 */
export const OPACITE_BANDES = [0.45, 0.28, 0.16, 0.08] as const;
