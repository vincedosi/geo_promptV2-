/**
 * Copie Angular (lot 4, P6) de `lib/carte/palette-pprt.ts:1-95` — LOGIQUE seule, verrouillee par
 * tests/unit/angular/carte-couches-paritaire.test.ts (gel P5 etendu a /map).
 *
 * Les couleurs du perimetre PPRT (`COULEURS_PPRT`, `COULEURS_PPRT_CSS`, `couleursPprt`) ne sont
 * pas recopiees : React les portait en `rgba` par theme, Angular les lit dans les jetons
 * `--pprt-contour` / `--pprt-fond` par `CouleursService` (jamais `var()` dans un `paint`).
 * `JETON_PPRT` en donne les NOMS (sans `--`).
 *
 * Pourquoi la palette est ACHROMATIQUE : sur cette carte la couleur porte le type de risque ; un
 * perimetre PPRT est une frontiere reglementaire opposable, c'est le TRAIT (continu, appuye) qui
 * porte l'autorite — trait plein = reglementaire, trait tirete = calcule (`nature-zone.ts`).
 * Ne pas corriger un defaut ici sans le corriger dans React.
 */

/** Nom des jetons CSS correspondants, lus par le test de coherence. */
export const JETONS_PPRT = ['--pprt-contour', '--pprt-fond'] as const;

/** Nom (sans `--`) du jeton de chaque couleur du perimetre, pour `CouleursService.palette()`. */
export const JETON_PPRT = {
  contour: 'pprt-contour',
  fond: 'pprt-fond',
} as const;

/**
 * Largeur du trait du perimetre, en pixels, par palier de zoom.
 *
 * Exportee plutot qu'ecrite dans le composant : la legende doit reproduire le
 * trait a l'identique, et le perimetre PPRT n'a plus que sa CONTINUITE et son
 * epaisseur pour se distinguer de la zone calculee (voir `nature-zone.ts`).
 */
export const LARGEUR_TRAIT_PPRT = 1.5;

/**
 * Libelles des deux familles de `type_zone`, plus l'aveu d'ignorance.
 *
 * `indetermine` est affiche tel quel et non masque : 7 des 664 zones portent
 * un `typeass` inexploitable a la source (la valeur `24`). Les cacher
 * retirerait de la carte des perimetres qui existent.
 */
export const LIBELLE_TYPE_ZONE_PPRT: Record<string, string> = {
  enveloppe: 'Enveloppe des zonages réglementaires',
  perimetre_reglemente: 'Périmètre réglementé',
  indetermine: 'Type non précisé à la source',
};
