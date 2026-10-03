/**
 * La palette qualitative des natures de risque.
 *
 * ── NI DIVERGENTE NI SÉQUENTIELLE ─────────────────────────────────────────
 *
 * Les natures de risque ne s'ordonnent pas : il n'y a ni plus ni moins entre
 * « Explosibles » et « Déchets ». Il faut donc des teintes DISTINCTES, pas les
 * paliers d'une même rampe. L'alternance chaud/froid les garde distinguables
 * en niveaux de gris et pour un daltonisme deutan — un dégradé rouge-vert
 * échouerait aux deux.
 *
 * ── POURQUOI CE FICHIER EXISTE ────────────────────────────────────────────
 *
 * Ces huit jetons vivaient dans `OngletRayonInfluence.tsx`, où ils servaient
 * les courbes. Le panneau ① en a besoin pour sa barre empilée : les mêmes
 * natures, sur le même écran, doivent porter les mêmes couleurs — sinon
 * « GPL et produits pétroliers » est orange dans un panneau et bleu dans le
 * suivant, et plus rien ne relie les deux lectures.
 *
 * Les recopier aurait donné deux palettes qui divergent au premier ajout de
 * teinte : c'est le défaut des quinze `fmtNum` de `lib/format/nombre.ts`.
 *
 * ── PAS DE DUPLICATION EN HEX ─────────────────────────────────────────────
 *
 * Contrairement aux palettes de `lib/carte/`, celle-ci n'est PAS doublée en
 * littéraux : elle est lue par Recharts et par le DOM, qui résolvent `var()`.
 * Seul MapLibre ne le fait pas, et aucune couche de carte ne colore par
 * nature.
 */

/** Les huit teintes, dans l'ordre d'attribution. Définies dans `app/globals.css`. */
export const TEINTES_NATURE = [
  'var(--nature-1)', 'var(--nature-2)', 'var(--nature-3)', 'var(--nature-4)',
  'var(--nature-5)', 'var(--nature-6)', 'var(--nature-7)', 'var(--nature-8)',
] as const;

/**
 * Le nombre de natures qu'on peut distinguer d'un coup d'œil.
 *
 * ⚠ La base en porte **quatorze** (mesuré le 2026-09-21 : toxicité aiguë, GPL,
 * explosibles, inflammables, déchets, milieu aquatique, chimie IED,
 * combustion, entrepôts, fluides frigorigènes, agroalimentaire…). Au-delà de
 * huit, les teintes se ressemblent et la légende demande plus d'effort que le
 * graphique n'en économise : les suivantes sont donc REGROUPÉES, jamais
 * recyclées sous une couleur déjà prise — deux natures de la même couleur est
 * pire que pas de couleur du tout.
 */
export const NATURES_DISTINGUABLES = 7;

/** Le libellé du regroupement. Nommé une fois, pour que l'écran et la légende s'accordent. */
export const LIBELLE_AUTRES_NATURES = 'Autres natures';

/**
 * La teinte d'une nature d'après son rang.
 *
 * @param rang - Le rang, à partir de 0, dans l'ordre d'affichage.
 * @returns Un jeton CSS. Le rang au-delà de la palette prend la DERNIÈRE
 *   teinte, réservée au regroupement « Autres natures ».
 */
export function teinteNature(rang: number): string {
  return TEINTES_NATURE[Math.min(rang, TEINTES_NATURE.length - 1)];
}

/** Une part du parc de sites, prête à peindre. */
export interface PartNature {
  libelle: string;
  n: number;
  teinte: string;
  /** Part du total, en pourcentage à une décimale. */
  pct: number;
  /** Vrai pour la ligne qui regroupe la queue de distribution. */
  regroupee: boolean;
}

/**
 * Ordonne les natures, garde les plus nombreuses et regroupe la queue.
 *
 * ── L'ORDRE EST CELUI DES EFFECTIFS ───────────────────────────────────────
 *
 * La nature dominante du parc est la première chose à voir. L'ordre
 * alphabétique ferait remonter « Agroalimentaire et divers » en tête d'une
 * liste qui sert justement à repérer le risque majoritaire.
 *
 * @param parNature - Les effectifs par nature, tels que la RPC les rend.
 * @returns Les parts à peindre, la plus nombreuse d'abord, le regroupement en
 *   dernier. Vide si aucun site.
 *
 * @example
 * partsDeNature({ A: 5, B: 3 })
 * // → [{ libelle: 'A', n: 5, pct: 62.5, … }, { libelle: 'B', n: 3, pct: 37.5, … }]
 */
export function partsDeNature(parNature: Record<string, number>): PartNature[] {
  const triees = Object.entries(parNature)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  const total = triees.reduce((t, [, n]) => t + n, 0);
  if (total === 0) return [];

  const gardees = triees.slice(0, NATURES_DISTINGUABLES);
  const queue = triees.slice(NATURES_DISTINGUABLES);
  const nQueue = queue.reduce((t, [, n]) => t + n, 0);

  const part = (libelle: string, n: number, rang: number, regroupee: boolean): PartNature => ({
    libelle,
    n,
    teinte: teinteNature(rang),
    pct: Math.round((n / total) * 1000) / 10,
    regroupee,
  });

  const parts = gardees.map(([libelle, n], i) => part(libelle, n, i, false));
  /*
   * Le regroupement n'apparaît QUE s'il porte quelque chose. Une part à zéro
   * s'afficherait dans la légende sans segment visible, et on chercherait où
   * elle est sur la barre.
   */
  if (nQueue > 0) {
    parts.push(part(LIBELLE_AUTRES_NATURES, nQueue, TEINTES_NATURE.length - 1, true));
  }
  return parts;
}
