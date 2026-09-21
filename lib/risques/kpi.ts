/**
 * Les rapports du bandeau KPI — la part et le taux d'utile.
 *
 * ── POURQUOI CES DEUX-LÀ SONT DANS UN FICHIER À PART ──────────────────────
 *
 * Ils se ressemblent : même numérateur, deux dénominateurs. C'est exactement ce
 * qui les rend faciles à confondre, et mesuré le 2026-09-21 sur l'écran réel :
 * à la maille région sur la France entière, les deux affichaient **32,4 %**,
 * sous deux libellés différents. La même journée, à la maille commune, ils
 * valaient 32,4 % et 67,0 %.
 *
 * Ce n'est pas un arrondi malheureux, c'est une dégénérescence : quand TOUTES
 * les unités du territoire sont touchées, la population des unités touchées
 * EST la population de référence, et le taux d'utile devient une copie de la
 * part. Deux nombres identiques sous deux noms font douter le lecteur du bon —
 * et celui qui les croit distincts en conclut que la dilution est nulle.
 */

/**
 * La part de la population du territoire qui vit en zone.
 *
 * @param total - Population couverte par le profil.
 * @param reference - Population du territoire étudié, du MÊME carroyage.
 * @returns Un pourcentage à une décimale, ou `null` si le dénominateur manque.
 */
export function partExposee(total: number, reference: number | null | undefined): number | null {
  if (!reference || reference <= 0) return null;
  return Math.round((total / reference) * 1000) / 10;
}

/**
 * Le taux d'utile : ce qu'on vise rapporté à ce qu'on achèterait.
 *
 * ── LA DÉGÉNÉRESCENCE, ET POURQUOI ELLE REND `null` ───────────────────────
 *
 * Acheter une unité entière pour n'en viser qu'une partie, c'est la dilution —
 * et elle ne se mesure que si des unités sont LAISSÉES DE CÔTÉ. Quand toutes
 * sont touchées, le rapport n'est plus une dilution : c'est la part, sous un
 * autre nom.
 *
 * La condition est une ÉGALITÉ, pas un seuil : `touchees >= reference` signifie
 * littéralement « aucune unité n'est laissée de côté ». Un seuil du genre
 * « moins de deux points d'écart » aurait été un nombre inventé, et il aurait
 * masqué des cas où l'écart est faible mais réel.
 *
 * ⚠ Ce n'est PAS le taux d'utile du plan média. Celui-là se mesure au CODE
 * POSTAL, le grain auquel le DSP achète, sur les codes réellement retenus après
 * le seuil de couverture — il vit à l'étape Zones (`appliquer_seuil_zone_set`,
 * mesuré à 75,9 % au seuil de 20 %). Celui-ci dit la dilution à la maille
 * affichée, et le bandeau nomme cette maille.
 *
 * @param total - Population couverte par le profil.
 * @param touchees - Population totale des unités touchées, avant troncature.
 * @param reference - Population du territoire étudié.
 * @returns Un pourcentage à une décimale, ou `null` quand le dénominateur
 *          manque (maille code postal) ou que toutes les unités sont touchées.
 *
 * @example
 * tauxUtile(20_674_572, 30_853_690, 63_783_569) // → 67 (maille commune)
 * tauxUtile(20_674_572, 63_783_569, 63_783_569) // → null (maille région)
 */
export function tauxUtile(
  total: number,
  touchees: number | null | undefined,
  reference: number | null | undefined,
): number | null {
  if (!touchees || touchees <= 0) return null;
  if (reference && touchees >= reference) return null;

  const taux = Math.round((total / touchees) * 1000) / 10;
  /*
   * ── ET QUAND LES DEUX SE CONFONDENT À L'AFFICHAGE ───────────────────────
   *
   * L'égalité exacte ne suffit pas, et la mesure l'a montré le jour même : à
   * la maille DÉPARTEMENT sur la France entière, presque toutes les unités
   * sont touchées — 22,1 % et 22,1 % s'affichaient côte à côte sous deux
   * libellés. Le dénominateur différait de quelques dizaines de milliers
   * d'habitants sur 63,8 millions, donc la garde d'égalité ne voyait rien.
   *
   * ⚠ Ce n'est PAS un seuil inventé : la comparaison se fait à la précision
   * RÉELLEMENT AFFICHÉE, une décimale. Si l'écran ne peut pas distinguer les
   * deux nombres, le second n'apprend rien — quelle que soit la distance qui
   * les sépare en arrière-plan.
   */
  const part = partExposee(total, reference);
  if (part !== null && part === taux) return null;
  return taux;
}
