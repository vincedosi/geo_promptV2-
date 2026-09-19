/**
 * Lecture des paramètres de requête partagés par les routes « zone à risque ».
 *
 * ── POURQUOI CE FICHIER EXISTE ─────────────────────────────────────────────
 *
 * `liste()` était recopiée à l'identique dans trois routes (`agregats`,
 * `export`, `rayon`) et `bboxValide()` dans deux (`map/risques-industriels`,
 * `map/pprt`) — cinq copies de deux validateurs d'entrée, constat R-17 de
 * `docs/AUDIT_ZONE_RISQUE.md`.
 *
 * Ce n'est pas une question d'élégance. Un durcissement — refuser une bbox hors
 * de France, plafonner le nombre de codes — ne se serait appliqué qu'à la copie
 * qu'on aurait pensé à modifier, et les quatre autres auraient continué
 * d'accepter ce que la première refuse. Les deux fonctions ci-dessous sont
 * désormais le seul endroit où cette règle est écrite.
 *
 * ⚠ Comportement STRICTEMENT identique aux copies remplacées : ces fonctions
 * sont la réunion exacte de ce que faisaient les cinq, y compris la tolérance
 * de `bboxValide` pour une entrée absente. Le refactor ne durcit rien — durcir
 * serait un changement de comportement, à décider séparément.
 */

/**
 * Découpe une liste séparée par des virgules, en écartant le vide.
 *
 * Rend `null` et non `[]` quand rien ne reste : côté RPC, `null` signifie
 * « pas de filtre » alors qu'un tableau vide signifierait « aucune valeur
 * acceptée », donc zéro résultat. Les deux ne se confondent pas.
 *
 * @param brut - La valeur brute du paramètre, éventuellement absente.
 * @returns Les valeurs non vides, ou `null` s'il n'y en a aucune.
 *
 * @example
 * liste('seveso_haut, seveso_bas')  // ['seveso_haut', 'seveso_bas']
 * liste('  ,  ')                    // null
 * liste(undefined)                  // null
 */
export function liste(brut: string | undefined): string[] | null {
  if (!brut) return null;
  const v = brut.split(',').map((s) => s.trim()).filter(Boolean);
  return v.length > 0 ? v : null;
}

/**
 * Lit une emprise `ouest,sud,est,nord` et la valide.
 *
 * Refuse une emprise dégénérée (`ouest >= est` ou `sud >= nord`) : PostGIS
 * accepterait `ST_MakeEnvelope` sur une telle boîte et rendrait zéro ligne sans
 * erreur, ce qui se lit comme « aucun site ici » au lieu de « votre emprise est
 * à l'envers ».
 *
 * @param brut - La valeur brute du paramètre, éventuellement absente.
 * @returns `[ouest, sud, est, nord]`, ou `null` si absente ou invalide.
 *
 * @example
 * bboxValide('4.9,43.3,5.4,43.6')  // [4.9, 43.3, 5.4, 43.6]
 * bboxValide('5.4,43.3,4.9,43.6')  // null — ouest à l'est de l'est
 * bboxValide(undefined)            // null
 */
export function bboxValide(brut: string | undefined): number[] | null {
  if (!brut) return null;
  const parts = brut.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [o, s, e, n] = parts;
  if (o >= e || s >= n) return null;
  return [o, s, e, n];
}
