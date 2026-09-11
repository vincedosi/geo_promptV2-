/**
 * @file lib/carreaux/expressions.ts
 *
 * Frontieres de classes partagees par la couleur peinte, la legende et le
 * filtre par palier.
 *
 * Avant : la couleur etait un `interpolate` continu dont les 6 arrets etaient
 * poses a `k/5` de l'etendue, tandis que legende et filtre decoupaient en
 * `k/6`. Une pastille pouvait donc annoncer une teinte que la carte n'employait
 * pas dans cette tranche. Un `step` sur CES bornes rend l'egalite vraie par
 * construction.
 */
import { palierEchelle, type BornesEchelle } from '@/lib/carreaux/bornes';

/**
 * Les `nPaliers - 1` frontieres internes, dans l'ordre croissant.
 *
 * @returns pour 6 classes, les 5 valeurs qui les separent — exactement les
 *          `max` des paliers 0 a 4, donc les `min` des paliers 1 a 5.
 */
export function bornesInternes(bornes: BornesEchelle, nPaliers: number): number[] {
  return Array.from({ length: nPaliers - 1 }, (_, k) => palierEchelle(bornes, k, nPaliers).max);
}

/**
 * Couleur des carreaux dont la donnée n'est pas exploitable.
 *
 * Un gris neutre, hors de toute palette : il ne peut être confondu avec aucune
 * valeur de l'échelle. En hexadécimal, comme toute couleur de peinture — le
 * moteur de rendu MapLibre ne résout pas les variables CSS dans les
 * expressions (exception documentée à la règle du DESIGN_SYSTEM).
 */
export const COULEUR_DONNEE_ABSENTE = '#9aa0a6';

/**
 * Prédicat : les deux propriétés nécessaires au quotient normalisé sont-elles
 * présentes ET exploitables ?
 *
 * ── Pourquoi ce garde-fou ───────────────────────────────────────────────────
 *
 * `carreauxNormaliseExpr` calcule `indicateur / dénominateur` avec deux
 * protections qui, prises isolément, sont raisonnables — et qui, ensemble,
 * fabriquent des valeurs plausibles à partir de données absentes :
 *
 *   `['to-number', ['get', ind], 0]`              → une propriété ABSENTE vaut 0
 *   `['max', ['to-number', ['get', denom], 0], 0.0001]` → un dénominateur
 *                                                   absent vaut 0,0001
 *
 * Conséquences, l'une discrète et l'autre spectaculaire :
 *
 *  - **Indicateur absent** → quotient nul → le carreau se peint au bas de
 *    l'échelle. La carte affirme « personne n'habite ici » là où la bonne
 *    réponse est « on ne sait pas ».
 *  - **Superficie absente** → division par 0,0001, soit une densité multipliée
 *    par 10 000 → le carreau ressort comme le plus dense de France. Une donnée
 *    manquante ne disparaît pas : elle invente un record.
 *
 * Aujourd'hui `get_tile` émet toujours les 29 colonnes et une superficie
 * littérale, donc aucun des deux cas ne se produit. Ce garde-fou ne change donc
 * RIEN au rendu actuel — c'est voulu. Il existe pour le jour où une tuile en
 * cache précède un changement de schéma, où un nouveau palier oublie une
 * colonne, ou où une agrégation laisse passer un NULL (MVT omet purement la
 * propriété). Ce jour-là, la carte dira « je ne sais pas » au lieu d'inventer.
 *
 * Le dénominateur nul est traité comme une absence : on ne peut pas plus
 * calculer une densité sur une surface nulle que sur une surface inconnue.
 *
 * @param ind   identifiant de l'indicateur affiché
 * @param denom nom de la colonne dénominateur (`denominateurDe(ind)`)
 */
export function donneeExploitableExpr(ind: string, denom: string): unknown[] {
  return ['all',
    ['has', ind],
    ['has', denom],
    ['>', ['to-number', ['get', denom], 0], 0],
  ];
}
