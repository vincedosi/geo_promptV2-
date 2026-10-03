/**
 * Style du contour d'une zone calculée — copie Angular de `lib/carte/nature-zone.ts:41-52`
 * (constantes seules : les statuts de zone arrivent avec la couche, tâche 12).
 */

export const TIRETE_ZONE_CALCULEE = [2, 2] as const;

/**
 * Largeur du contour d'une zone calculee, en pixels.
 *
 * Plus fine que `LARGEUR_TRAIT_PPRT` (1,5) a dessein : le perimetre
 * reglementaire doit primer visuellement sur un cercle que nous avons
 * choisi. Elle etait ecrite en dur des deux cotes — `line-width: 1` dans la
 * couche, et une bordure CSS dans la legende, qui pouvaient deriver sans
 * que rien ne le signale.
 */
export const LARGEUR_TRAIT_ZONE = 1;
