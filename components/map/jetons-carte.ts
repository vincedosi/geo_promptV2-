/**
 * Jetons du design system consommés par les calques MapLibre.
 *
 * MapLibre ne résout PAS `var()` dans un bloc `paint` : une couleur doit y
 * arriver sous forme de littéral. Deux façons de s'y prendre, une seule
 * correcte :
 *
 *  - ✗ lire la valeur UNE fois au montage et la figer (`getComputedStyle`
 *    dans un effet `[]`) : la couche garde la couleur du thème de l'instant,
 *    et basculer sombre → clair laisse un fond noir sous les polygones au
 *    milieu d'une page blanche ;
 *  - ✓ lire la valeur AU MOMENT de l'application, depuis un effet keyé sur le
 *    thème, gardé par `isStyleLoaded()` avec repli `once('load')`.
 *
 * Ce module ne sert que le second usage. Le repli n'est pas décoratif : en
 * test (env `node`) et avant l'hydratation, `getComputedStyle` peut ne rien
 * rendre — une chaîne vide dans `paint` ferait rejeter toute l'expression EN
 * SILENCE (piège déjà vécu sur la heatmap POI, cf. `resolveCssRgb`).
 */

/** Contour des zones d'une choroplèthe — s'inverse entre les deux thèmes. */
export const JETON_CONTOUR_CARTE = '--contour-carte';
/** Halo des étiquettes de zone — s'inverse entre les deux thèmes. */
export const JETON_HALO_CARTE = '--halo-carte';
/** Couleur de texte des étiquettes de zone. */
export const JETON_TEXTE_CARTE = '--text-primary';
/** Fond plein des instances MapLibre sans tuile (vignettes du Suivi V2). */
export const JETON_FOND_CARTE = '--bg-primary';

const REPLIS: Record<string, string> = {
  [JETON_CONTOUR_CARTE]: 'rgba(255,255,255,0.16)',
  [JETON_HALO_CARTE]: 'rgba(0,0,0,0.75)',
  [JETON_TEXTE_CARTE]: '#f0f0f0',
  [JETON_FOND_CARTE]: '#050505',
};

/**
 * Valeur courante d'un jeton CSS, lue sur `:root` au moment de l'appel.
 * Rend le repli sombre si le document est absent ou le jeton vide.
 */
export function lireJetonCarte(nom: string, repli?: string): string {
  const defaut = repli ?? REPLIS[nom] ?? '';
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return defaut;
  const valeur = getComputedStyle(document.documentElement).getPropertyValue(nom).trim();
  return valeur || defaut;
}

/**
 * Exécute `action` APRÈS que la classe de thème a été posée sur `<html>`.
 *
 * `ThemeProvider` (lib/theme/ThemeProvider.tsx) pose `html.light` / `html.dark`
 * dans un `useEffect` de PARENT. Or React exécute les effets des DESCENDANTS
 * avant ceux de leurs parents dans un même commit : un effet keyé sur `theme`
 * qui lirait `getComputedStyle` directement verrait encore les jetons du thème
 * PRÉCÉDENT, et repeindrait la carte avec les couleurs qu'on vient de quitter.
 * Une frame d'attente lève l'ambiguïté et reste déterministe — React vide
 * toutes ses passive effects dans la même tâche, le callback de
 * `requestAnimationFrame` s'exécute après.
 *
 * Rend une fonction d'annulation à retourner depuis l'effet appelant.
 */
export function apresApplicationDuTheme(action: () => void): () => void {
  if (typeof requestAnimationFrame !== 'function') {
    const t = setTimeout(action, 0);
    return () => clearTimeout(t);
  }
  const id = requestAnimationFrame(action);
  return () => cancelAnimationFrame(id);
}
