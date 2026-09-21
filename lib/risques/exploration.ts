/**
 * L'exploration LOCALE du tableau de couverture.
 *
 * ── POURQUOI ELLE EST SÉPARÉE DU FILTRE TERRITOIRE ────────────────────────
 *
 * Jusqu'au 2026-09-21, cliquer une ligne du tableau écrivait le filtre
 * « Territoire » de la barre commune. Conséquence : on descendait dans une
 * région pour REGARDER ses départements, et tout l'écran basculait avec —
 * le bandeau KPI, la courbe, les autres étapes. Revenir demandait de se
 * souvenir d'où l'on venait.
 *
 * Le filtre Territoire dit **ce qu'on étudie** ; l'exploration dit **ce qu'on
 * est en train de regarder dans le tableau**. Les confondre revient à changer
 * de sujet chaque fois qu'on tourne une page.
 *
 * ── UN CHEMIN, PAS UN NIVEAU ──────────────────────────────────────────────
 *
 * On garde la SUITE des unités traversées, et non le seul niveau courant :
 * remonter demande de savoir d'où l'on vient, et un niveau seul l'a déjà
 * oublié. C'est aussi ce qui permet d'afficher « France › PACA › Bouches-du-
 * Rhône » sans consulter quoi que ce soit.
 */
import type { Dimension } from '@/lib/risques/dimensions';

/**
 * Les deux seuls niveaux dans lesquels on peut descendre.
 *
 * ⚠ NON exporté : il n'a aucun consommateur hors de ce fichier —
 * `SegmentExploration` le porte déjà pour eux — et un export sans
 * consommateur est du code mort que `npm run catalogue` compte. Le cliquet
 * l'a attrapé le jour même.
 */
type NiveauExplore = 'region' | 'departement';

export interface SegmentExploration {
  niveau: NiveauExplore;
  code: string;
  nom: string;
}

/** Le périmètre tel que la RPC l'attend : deux arguments, jamais un seul. */
export interface PerimetreExplore {
  /**
   * ⚠ Code de RÉGION, distinct de `parent` qui est un code de DÉPARTEMENT.
   *
   * Les deux nomenclatures INSEE se recouvrent sur **18 codes** — `75` vaut
   * Paris ET la Nouvelle-Aquitaine — et les confondre a déjà coûté un
   * drill-down qui rendait 164 codes postaux au lieu de 21 (sql/171).
   */
  region: string | null;
  parent: string | null;
}

/**
 * La maille des lignes affichées, d'après le chemin exploré.
 *
 * @param chemin - Les unités traversées, de la plus large à la plus fine.
 * @param mailleGlobale - La maille choisie dans « Lister par ».
 * @returns La maille à lister. Hors exploration, c'est celle de la barre — on
 *   n'impose rien tant que l'utilisateur n'a pas cliqué.
 *
 * @example
 * mailleExploree([], 'region')                                   // 'region'
 * mailleExploree([{ niveau: 'region', … }], 'region')            // 'departement'
 */
export function mailleExploree(
  chemin: SegmentExploration[],
  mailleGlobale: Dimension,
): Dimension {
  if (chemin.length === 0) return mailleGlobale;
  const dernier = chemin[chemin.length - 1];
  if (dernier.niveau === 'region') return 'departement';
  /*
   * Sous le département, la maille fine est celle que l'utilisateur a choisie
   * dans la barre — commune ou code postal. Le brief les traite comme UN seul
   * niveau (« commune / code postal ») parce qu'elles sont sœurs et non
   * imbriquées : descendre encore n'aurait pas de sens, on changerait de
   * découpage sans changer d'échelle.
   */
  return mailleGlobale === 'code_postal' ? 'code_postal' : 'commune';
}

/**
 * Le périmètre à passer à la RPC pour le tableau exploré.
 *
 * ⚠ Il PART du périmètre global, il ne le remplace pas : explorer PACA à
 * l'intérieur d'un filtre « Bouches-du-Rhône » n'a pas de sens, mais explorer
 * un département à l'intérieur d'un filtre national en a.
 *
 * @param chemin - Les unités traversées.
 * @param global - Le périmètre du filtre Territoire.
 * @returns Le couple (région, département) à envoyer.
 */
export function perimetreExplore(
  chemin: SegmentExploration[],
  global: PerimetreExplore,
): PerimetreExplore {
  if (chemin.length === 0) return global;
  const region = chemin.find((s) => s.niveau === 'region');
  const departement = chemin.find((s) => s.niveau === 'departement');
  return {
    // Le département suffit à lui seul : il est plus fin que la région, et
    // envoyer les deux ferait filtrer deux fois la même chose.
    region: departement ? null : (region?.code ?? global.region),
    parent: departement?.code ?? global.parent,
  };
}

/**
 * Peut-on descendre depuis cette maille ?
 *
 * Seules la région et le département ont un niveau en dessous. La commune et
 * le code postal sont le dernier étage — le carroyage de 200 m existe, mais on
 * n'en liste pas 2,3 millions de lignes.
 */
export function peutDescendre(maille: Dimension): boolean {
  return maille === 'region' || maille === 'departement';
}

/** Peut-on remonter ? Seulement si l'on est descendu. */
export function peutRemonter(chemin: SegmentExploration[]): boolean {
  return chemin.length > 0;
}

/**
 * Descend dans une unité.
 *
 * @param chemin - Le chemin courant.
 * @param maille - La maille des lignes affichées, donc le niveau de l'unité.
 * @param code - Le code de l'unité cliquée.
 * @param nom - Son nom, pour le fil d'Ariane local.
 * @returns Le nouveau chemin, ou le MÊME si la descente n'a pas de sens —
 *   renvoyer un chemin inchangé évite un rendu et une requête pour rien.
 */
export function descendre(
  chemin: SegmentExploration[],
  maille: Dimension,
  code: string,
  nom: string,
): SegmentExploration[] {
  if (!peutDescendre(maille)) return chemin;
  return [...chemin, { niveau: maille as NiveauExplore, code, nom }];
}

/** Remonte d'un cran. Rend le même chemin s'il est déjà à la racine. */
export function remonter(chemin: SegmentExploration[]): SegmentExploration[] {
  return chemin.length === 0 ? chemin : chemin.slice(0, -1);
}
