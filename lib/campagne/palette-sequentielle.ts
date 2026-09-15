/**
 * Échelle séquentielle (intensité croissante), pour les vignettes
 * « Impressions » et « Variable du plan » du Suivi V2 (Tâche 13A).
 *
 * Même patron que `palette-divergente.ts`, et même raison d'être : le DOM lit
 * les tokens `--seq-*` de globals.css, MapLibre ne résout PAS `var()` dans
 * `paint` et reçoit les hex littéraux ci-dessous. La correspondance est
 * verrouillée par `tests/unit/campagne/palette-sequentielle-css.test.ts`
 * (même méthode que `palette-divergente-css.test.ts` : elle lit le VRAI
 * fichier CSS, ne simule pas son contenu).
 *
 * Une seule rampe sert les deux vignettes séquentielles : ce n'est pas la
 * couleur qui distingue « Impressions » de « Variable du plan » (toutes deux
 * sont des intensités croissantes, sans signe), mais le domaine de données et
 * la légende. Teinte dérivée de l'accent de marque (--brand-teal #4ecdc4),
 * du plus sombre/neutre (valeur faible) au teal plein (valeur forte) —
 * cohérent avec DESIGN_SYSTEM.md §3 (« la couleur n'apparaît que pour le
 * statut ou l'interaction », ici l'intensité de la donnée).
 */

export const RAMPE_SEQUENTIELLE: Record<'dark' | 'light', string[]> = {
  dark: ['#132625', '#1b3d3a', '#2a6b62', '#3a9e91', '#4ecdc4'],
  light: ['#eaf7f5', '#c3ebe6', '#8ed6cc', '#4fb3a6', '#1f8a7c'],
}
