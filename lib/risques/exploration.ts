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

/**
 * Les codes des unités que la mini-carte doit dessiner.
 *
 * ── POURQUOI CETTE FONCTION EXISTE ────────────────────────────────────────
 *
 * Le filtre de la mini-carte vivait dans `AnalysePopulationOverlay`, et il ne
 * connaissait QUE le fil d'Ariane du filtre Territoire (`chemin`). Il sortait
 * sur `if (chemin.length === 0) return zones` — tout dessiner.
 *
 * L'exploration locale du tableau, ajoutée le 2026-09-21, est un état
 * DIFFÉRENT, et c'est tout son intérêt : explorer ne change pas le sujet de
 * l'écran. Le filtre de la carte n'en a jamais été informé. Conséquence
 * mesurée le 2026-09-22, en vue « France entière » : descendre dans
 * l'Île-de-France listait ses **8 départements** au tableau pendant que la
 * carte en dessinait **96** — toute la France, sans lien avec ce qu'on lit.
 *
 * Le second défaut était dans la même expression : les branches testaient la
 * maille GLOBALE (`dimension`), qui vaut encore « région » quand on explore,
 * alors que la maille DESSINÉE est celle du tableau exploré.
 *
 * ⚠ `unites` peut être vide pendant un recalcul (2,8 s sur la France). On ne
 * retombe pas sur « tout montrer » dans ce cas : les codes déduits du chemin
 * — les départements de la région explorée — tiennent le cadrage pendant
 * l'attente. Sans eux, la carte affichait la France entière quelques secondes
 * à chaque descente, ce qui se lit comme une carte qui ne suit pas.
 *
 * @param opts.chemin - Fil d'Ariane du filtre Territoire (ce qu'on ÉTUDIE).
 * @param opts.exploration - Fil d'Ariane local du tableau (ce qu'on REGARDE).
 * @param opts.mailleDessinee - La maille réellement listée ET dessinée.
 * @param opts.unites - Les unités rendues par le calcul, y compris celles qui
 *   débordent du territoire : un site voisin apporte sa population ici.
 * @param opts.deptsParRegion - Le référentiel région -> départements.
 * @returns Les codes à garder, ou `null` pour « tout dessiner » — le cas d'une
 *   vue nationale non explorée, où la France entière EST le sujet.
 */
export function codesDessines(opts: {
  chemin: SegmentExploration[];
  exploration: SegmentExploration[];
  mailleDessinee: Dimension;
  unites: string[];
  deptsParRegion: Record<string, string[]>;
}): Set<string> | null {
  const { chemin, exploration, mailleDessinee, unites, deptsParRegion } = opts;
  const dernier = exploration[exploration.length - 1] ?? chemin[chemin.length - 1] ?? null;
  if (dernier === null) return null;

  const codes = new Set<string>();
  if (mailleDessinee === 'departement') {
    if (dernier.niveau === 'region') {
      for (const c of deptsParRegion[dernier.code] ?? []) codes.add(c);
    } else {
      codes.add(dernier.code);
    }
  }
  for (const u of unites) codes.add(u);

  // Aucun code résolu : mieux vaut tout montrer que rien, une carte vide se
  // lisant comme une panne. Ne survient que si le référentiel est muet ET le
  // calcul sans résultat.
  return codes.size === 0 ? null : codes;
}
