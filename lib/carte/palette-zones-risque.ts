/**
 * La palette des zones de risque, pour MapLibre et pour le DOM.
 *
 * ── POURQUOI DEUX COPIES DES MÊMES COULEURS ───────────────────────────────
 *
 * MapLibre **ne résout pas `var()`** dans `paint` : une couleur y arrive en
 * littéral ou ne s'affiche pas. Le DOM, lui, doit lire les jetons pour suivre
 * la bascule de thème sans repeindre. Même patron que
 * `lib/campagne/palette-divergente.ts` et `lib/carte/palette-risques.ts`, et
 * pour la même raison — pas par négligence.
 *
 * Les deux copies sont verrouillées ensemble par
 * `tests/unit/carte/palette-zones-risque.test.ts` : un hex changé d'un côté
 * seulement fait échouer la suite.
 *
 * ── CE QUE LA TEINTE DIT, ET CE QUE L'OPACITÉ DIT ────────────────────────
 *
 * La teinte dit le NIVEAU (seuil haut, seuil bas), l'opacité dit la DISTANCE.
 * Deux variables, deux canaux visuels : on lit « seuil haut, deuxième bande »
 * d'un seul coup d'œil, sans revenir à la légende.
 *
 * Chaud contre ambre, jamais rouge contre vert : le seuil bas n'est pas « sans
 * danger », c'est un seuil plus bas. Un couple rouge/vert le dirait faux et
 * serait illisible pour un daltonisme deutan.
 */
import type { Niveau } from '@/lib/risques/profil';

/** Les teintes littérales, pour `paint`. Miroir des jetons `--niveau-*`. */
export const COULEUR_NIVEAU: Record<'dark' | 'light', Record<Niveau, string>> = {
  dark: {
    haut: '#e0603f',
    bas: '#d99a1f',
    autres: '#7a8b9c',
  },
  light: {
    haut: '#b8431f',
    bas: '#a8720a',
    autres: '#5a6b7c',
  },
};

/** Les mêmes teintes, en jetons, pour le DOM — légende et pastilles. */
export const COULEUR_NIVEAU_CSS: Record<Niveau, string> = {
  haut: 'var(--niveau-haut)',
  bas: 'var(--niveau-bas)',
  autres: 'var(--niveau-autres)',
};

/**
 * Opacité de remplissage, du cœur vers l'extérieur.
 *
 * ⚠ Dégressive, et c'est ce qui rend la superposition lisible. Les zones sont
 * EXCLUSIVES par construction (sql/205 les découpe par `ST_Difference`), donc
 * aucune opacité ne s'empile : ce qu'on voit à un endroit est la couleur d'UNE
 * seule bande, jamais la somme de plusieurs. Sans cette exclusivité, un centre
 * couvert par quatre anneaux atteindrait 0,45 + 0,28 + 0,16 + 0,08 et
 * saturerait en aplat opaque.
 *
 * Le cinquième palier n'existe pas : quatre anneaux au maximum par niveau
 * (`ANNEAUX_MAX`). Une bande au-delà retomberait sur la dernière valeur, ce
 * qui la rendrait indistinguable de sa voisine.
 */
export const OPACITE_BANDE = [0.45, 0.28, 0.16, 0.08] as const;

/**
 * Opacité du périmètre PPRT.
 *
 * La plus forte de toutes : c'est la seule zone qui ne vient pas d'un rayon
 * que nous avons choisi, et elle doit se distinguer AVANT qu'on lise la
 * légende. Le trait plein de son contour dit la même chose (les bandes
 * calculées sont tiretées, convention de `lib/carte/nature-zone.ts`).
 */
export const OPACITE_PPRT = 0.5;

/**
 * L'opacité d'une classe.
 *
 * @param bande - Le numéro de bande à partir de 1, ou `'pprt'`.
 * @returns L'opacité de remplissage.
 *
 * @example
 * opaciteDeClasse('pprt') // 0.5
 * opaciteDeClasse(1)      // 0.45
 * opaciteDeClasse(9)      // 0.08 — plafonnée à la dernière valeur connue
 */
export function opaciteDeClasse(bande: number | 'pprt'): number {
  if (bande === 'pprt') return OPACITE_PPRT;
  return OPACITE_BANDE[Math.min(Math.max(bande, 1), OPACITE_BANDE.length) - 1];
}

/**
 * L'expression MapLibre qui colore une zone d'après sa propriété `niveau`.
 *
 * Une expression et non un `setPaintProperty` par classe : la couche est
 * UNIQUE, et peindre chaque classe séparément demanderait autant de couches
 * MapLibre que de bandes — jusqu'à huit, recréées à chaque anneau déplacé.
 *
 * @param theme - Le thème courant.
 * @returns L'expression `match` à poser dans `paint`.
 */
export function expressionCouleurNiveau(theme: 'dark' | 'light'): unknown[] {
  const c = COULEUR_NIVEAU[theme];
  return [
    'match', ['get', 'niveau'],
    'haut', c.haut,
    'bas', c.bas,
    'autres', c.autres,
    c.autres,
  ];
}

/**
 * L'expression MapLibre qui règle l'opacité d'après `bande`.
 *
 * `bande` vaut `null` pour un périmètre PPRT — c'est ainsi que sql/205 l'écrit,
 * et le distinguer par l'absence de numéro plutôt que par une valeur sentinelle
 * évite qu'un `0` soit un jour lu comme une bande.
 *
 * @param theme - Non utilisé : l'opacité ne dépend pas du thème, seulement la
 *   teinte. Le paramètre n'existe pas, pour que personne ne le cherche.
 * @returns L'expression `case` à poser dans `fill-opacity`.
 */
export function expressionOpaciteBande(): unknown[] {
  return [
    'case',
    ['==', ['get', 'bande'], null], OPACITE_PPRT,
    ['==', ['get', 'bande'], 1], OPACITE_BANDE[0],
    ['==', ['get', 'bande'], 2], OPACITE_BANDE[1],
    ['==', ['get', 'bande'], 3], OPACITE_BANDE[2],
    OPACITE_BANDE[3],
  ];
}

/**
 * L'opacité d'un niveau vu de loin, bandes fondues.
 *
 * Entre les quatre paliers de `OPACITE_BANDE` : plus dense que la dernière
 * bande — sinon l'emprise disparaîtrait au dézoom — sans atteindre celle du
 * cœur, qui ferait lire tout le disque comme la zone la plus proche.
 *
 * ⚠ NON exportée, à dessein : rien d'autre que la fonction ci-dessous ne s'en
 * sert, et un export sans consommateur est du code mort que `npm run catalogue`
 * compte — le cliquet de `tests/unit/docs/catalogue-code.test.ts` l'a attrapé
 * le jour même. La légende, elle, n'affiche pas cette valeur : elle liste les
 * bandes, qui n'existent qu'au zoom de détail.
 */
const OPACITE_NIVEAU_FONDU = 0.32;

/**
 * L'opacité de remplissage SELON LE ZOOM : fondue de loin, détaillée de près.
 *
 * ── POURQUOI FONDRE LES BANDES AU DÉZOOM ──────────────────────────────────
 *
 * À z8, un anneau de 500 m fait deux pixels : quatre opacités dégressives n'y
 * sont plus quatre informations, elles donnent un bord sale. La question de
 * cette échelle est « où sont les zones du seuil haut », pas « à quelle
 * distance exacte » — et on y répond en aplat uni par niveau.
 *
 * ⚠ `step` et non `interpolate` : une opacité qui glisserait progressivement
 * entre les deux régimes afficherait, à mi-chemin, des bandes à demi fondues
 * qui ne correspondraient à aucune lecture. La bascule est nette, et le seuil
 * est `ZONES_RISQUE_ZOOM_DETAIL`, déclaré une seule fois.
 *
 * @param zoomDetail - Le zoom de bascule (`ZONES_RISQUE_ZOOM_DETAIL`), passé
 *   en argument pour que ce module reste sans dépendance vers `lib/version.ts`.
 * @returns L'expression à poser dans `fill-opacity`.
 */
export function expressionOpaciteSelonZoom(zoomDetail: number): unknown[] {
  return ['step', ['zoom'], OPACITE_NIVEAU_FONDU, zoomDetail, expressionOpaciteBande()];
}
