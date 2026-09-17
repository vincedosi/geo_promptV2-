/**
 * Couleurs du périmètre PPRT sur la carte.
 *
 * ── POURQUOI CETTE PALETTE EST ACHROMATIQUE ───────────────────────────────
 *
 * Sur cette carte, la couleur porte le **type de risque**
 * (`lib/carte/palette-risques.ts` : toxique, inflammable, pollution, autres).
 * Un périmètre PPRT n'est pas une donnée d'intensité ni un type : c'est une
 * **frontière réglementaire opposable**. Lui donner une teinte la mettrait en
 * concurrence avec les quatre autres, et un lecteur chercherait à savoir « de
 * quel risque » cette couleur parle.
 *
 * Le design system tranche la question à notre place : « monochrome par
 * défaut, la couleur n'apparaît que pour le statut ou l'interaction ». C'est
 * donc le TRAIT qui porte l'autorité — net, tireté, appuyé — et pas la teinte.
 * Le tireté distingue en plus le périmètre officiel du cercle de danger
 * calculé (sql/175), qui est un aplat plein : deux objets de nature
 * différente ne doivent pas se dessiner pareil.
 *
 * ── LES VALEURS SONT ÉCRITES DEUX FOIS, ET C'EST INÉVITABLE ───────────────
 *
 * MapLibre ne résout pas `var()` dans `paint`. Même patron que
 * `palette-divergente.ts` et `palette-sequentielle.ts` : les jetons vivent
 * dans `app/globals.css` (`:root` et `html.light`) et sont dupliqués ici en
 * littéraux, les deux copies verrouillées ensemble par
 * `tests/unit/carte/palette-pprt.test.ts`.
 */

/** Nom des jetons CSS correspondants, lus par le test de cohérence. */
export const JETONS_PPRT = ['--pprt-contour', '--pprt-fond'] as const;

export interface CouleursPprt {
  /** Trait du périmètre. */
  contour: string;
  /** Aplat très discret, juste de quoi rendre la zone cliquable et lisible. */
  fond: string;
}

export const COULEURS_PPRT: Record<'dark' | 'light', CouleursPprt> = {
  dark: {
    contour: 'rgba(240,240,240,0.85)',
    fond: 'rgba(240,240,240,0.10)',
  },
  light: {
    contour: 'rgba(26,26,26,0.80)',
    fond: 'rgba(26,26,26,0.08)',
  },
};

/** Pour l'aperçu de la légende, où `var()` fonctionne. */
export const COULEURS_PPRT_CSS: CouleursPprt = {
  contour: 'var(--pprt-contour)',
  fond: 'var(--pprt-fond)',
};

/**
 * Tireté du contour, en multiples de la largeur du trait.
 *
 * Exporté plutôt qu'écrit dans le composant : c'est ce motif qui distingue le
 * périmètre réglementaire du cercle de danger calculé, et la légende doit
 * pouvoir le reproduire sans le retyper.
 */
export const TIRETE_PPRT = [3, 2] as const;

/**
 * Libellés des deux familles de `type_zone`, plus l'aveu d'ignorance.
 *
 * `indetermine` est affiché tel quel et non masqué : 7 des 664 zones portent
 * un `typeass` inexploitable à la source (la valeur `24`). Les cacher
 * retirerait de la carte des périmètres qui existent.
 */
export const LIBELLE_TYPE_ZONE_PPRT: Record<string, string> = {
  enveloppe: 'Enveloppe des zonages réglementaires',
  perimetre_reglemente: 'Périmètre réglementé',
  indetermine: 'Type non précisé à la source',
};

export function couleursPprt(theme: 'dark' | 'light'): CouleursPprt {
  return COULEURS_PPRT[theme];
}
