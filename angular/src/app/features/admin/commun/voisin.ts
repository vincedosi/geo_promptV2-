/** Touches qui déplacent le focus entre onglets (motif ARIA « tabs »). */
export type ToucheOnglet = 'ArrowRight' | 'ArrowLeft';

/**
 * Index de l'onglet voisin de `i` parmi `n`, en boucle : → le suivant (le premier après le dernier),
 * ← le précédent (le dernier avant le premier). Partagé par `mg-onglets-routes` et la fiche d'un espace
 * (vague finale H5) : les deux recopiaient la même arithmétique.
 */
export function voisin(i: number, n: number, touche: ToucheOnglet): number {
  return (i + (touche === 'ArrowRight' ? 1 : n - 1)) % n;
}
