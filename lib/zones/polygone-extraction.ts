/**
 * @file lib/zones/polygone-extraction.ts — A7 (sql/312) : la forme envoyée en maille POLYGONE, à l'extraction d'un jeu
 * de zone. La base la simplifie (`simplification_polygone_plateforme` : depuis D37, sql/340, TOUJOURS à 50 m, puis
 * morceaux de moins de 0,04 km² retirés — deux réglages de `reglages_conversion`) et en rend la mesure ; ce module dit, sans I/O, si elle dépasse les bornes de la plateforme (refus) et si la perte de
 * population induite doit être affichée (avertissement).
 *
 * Serveur seulement : l'écran ⑤ ne rejoue pas cette règle (la mesure exige la base), il AFFICHE l'avertissement figé
 * (`texteAvertissement`, côté Angular). Aucune borne n'est écrite ici : elles se lisent dans la ligne de
 * `plateformes_geo` (`polygone_sommets_max`, `polygone_morceaux_max`) et dans la mesure (seuil d'affichage) ; le grep
 * de `tests/unit/zones/conversion.test.ts` le verrouille.
 */
import type { Avertissement, ResumeMaille } from './conversion';
import type { PlateformeGeo } from './plateformes';

/**
 * A7 (sql/312) : ce que `simplification_polygone` mesure de la forme envoyée en maille polygone — sommets (anneaux
 * compris) et morceaux avant et après la simplification Douglas-Peucker à `tolerance_m` (réglage en base), habitants de
 * la zone hors de la forme simplifiée (`perdue`) et habitants hors zone dedans (`gagnee`), seuil d'affichage de la perte.
 */
export interface MesureSimplification {
  /**
   * D37 (sql/340) : la tolérance appliquée, `reglages_conversion.simplification_polygone_m` (50 m), pour TOUTE forme.
   * Avant D37 (sql/313) : le palier retenu, 0 sans simplification — une extraction figée avant D37 peut le porter.
   */
  tolerance_m: number;
  /** D37 : surface minimale d'un morceau (km², `polygone_morceau_min_km2`) ; absent avant D37. */
  morceau_min_km2?: number;
  /** D37 : morceaux retirés parce que plus petits que `morceau_min_km2` (leur population est dans `perdue`). */
  morceaux_retires?: number;
  /** La forme envoyée diffère de la zone (sommets ou morceaux retirés). */
  simplifiee: boolean;
  /** Tour 1 : la forme envoyée passe sous les bornes lues par la base (faux = refus). Absent avant sql/313. */
  sous_bornes?: boolean;
  sommets_avant: number;
  morceaux_avant: number;
  sommets: number;
  morceaux: number;
  perdue: number;
  gagnee: number;
  /** % de la population de la zone au-delà duquel la perte est affichée (`reglages_conversion.perte_simplification_affichee`). */
  seuil_perte_affichee: number;
}

/** Une borne du polygone que la forme simplifiée dépasse : `valeur` obtenue, `limite` admise par la plateforme. */
export interface DepassementPolygone {
  code: 'polygone_sommets_max' | 'polygone_morceaux_max';
  limite: number;
  valeur: number;
  a_verifier?: true;
}

/**
 * A7 : les bornes du polygone (`plateformes_geo.polygone_sommets_max`, `polygone_morceaux_max`) que la forme SIMPLIFIÉE
 * dépasse — la borne atteinte est admise. Un dépassement REFUSE l'extraction (ce n'est pas un avertissement : la
 * plateforme rejetterait le fichier). Aucune borne connue (NULL ou absente) : rien n'est refusé. `a_verifier` si la
 * ligne déclare la borne non confirmée (amendement E9).
 */
export function depassementsPolygone(m: Pick<MesureSimplification, 'sommets' | 'morceaux'>, ligne: PlateformeGeo): DepassementPolygone[] {
  const bornes = [
    { code: 'polygone_sommets_max' as const, limite: ligne.polygone_sommets_max, valeur: m.sommets },
    { code: 'polygone_morceaux_max' as const, limite: ligne.polygone_morceaux_max, valeur: m.morceaux },
  ];
  const aVerifier = ligne.parametres_a_verifier ?? [];
  return bornes.flatMap(({ code, limite, valeur }) => (limite === null || limite === undefined || valeur <= limite ? [] : [{
    code, limite, valeur, ...(aVerifier.includes(code) ? { a_verifier: true as const } : {}),
  }]));
}

/**
 * A7 : la perte de la simplification, dite si la part de la population de la zone hors de la forme simplifiée dépasse
 * strictement le seuil lu en base (0,1 % au 01/11). `valeur` en %, deux décimales ; `n` les habitants perdus. Rien pour
 * une zone sans population (aucune part à calculer) ni pour une perte nulle.
 */
export function avertissementSimplification(m: Pick<MesureSimplification, 'perdue' | 'seuil_perte_affichee'>, population: number): Avertissement[] {
  if (!(population > 0) || !(m.perdue > 0)) return [];
  const part = (100 * m.perdue) / population;
  if (part <= m.seuil_perte_affichee) return [];
  return [{ code: 'perte_simplification', limite: m.seuil_perte_affichee, valeur: Math.round(part * 100) / 100, n: m.perdue }];
}

/**
 * Tour 1 (M-1 de la relecture) : le bilan d'un polygone dont la forme envoyée a été SIMPLIFIÉE — ce n'est plus la zone,
 * donc plus une maille exacte : `manques` = habitants de la zone hors de la forme envoyée (`perdue`), `hors_zone` =
 * habitants hors zone dedans (`gagnee`), `couverte = population − perdue`, `achetee = couverte + gagnee`, taux d'utile
 * au dixième (règle de `appliquerSeuil`). `null` si rien n'a changé de côté (forme non simplifiée, ou aucune population
 * dans la bande) : le bilan exact reste vrai.
 */
export function resumePolygoneSimplifie(
  m: Pick<MesureSimplification, 'simplifiee' | 'perdue' | 'gagnee'>, population: number,
): ResumeMaille | null {
  if (!m.simplifiee || m.perdue + m.gagnee <= 0) return null;
  const couverte = population - m.perdue;
  const achetee = couverte + m.gagnee;
  return {
    exacte: false, n_unites: 1, n_touchees: 1, couverte, achetee, manques: m.perdue, hors_zone: m.gagnee,
    taux_utile: achetee > 0 ? Math.round((1000 * couverte) / achetee) / 10 : null,
  };
}
