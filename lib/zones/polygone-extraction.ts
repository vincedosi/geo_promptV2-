/**
 * @file lib/zones/polygone-extraction.ts — A7 (sql/312) : la forme envoyée en maille POLYGONE, à l'extraction d'un jeu
 * de zone. La base la simplifie (`simplification_polygone`, Douglas-Peucker à la tolérance de `reglages_conversion`) et
 * en rend la mesure ; ce module dit, sans I/O, si elle dépasse les bornes de la plateforme (refus) et si la perte de
 * population induite doit être affichée (avertissement).
 *
 * Serveur seulement : l'écran ⑤ ne rejoue pas cette règle (la mesure exige la base), il AFFICHE l'avertissement figé
 * (`texteAvertissement`, côté Angular). Aucune borne n'est écrite ici : elles se lisent dans la ligne de
 * `plateformes_geo` (`polygone_sommets_max`, `polygone_morceaux_max`) et dans la mesure (seuil d'affichage) ; le grep
 * de `tests/unit/zones/conversion.test.ts` le verrouille.
 */
import type { Avertissement } from './conversion';
import type { PlateformeGeo } from './plateformes';

/**
 * A7 (sql/312) : ce que `simplification_polygone` mesure de la forme envoyée en maille polygone — sommets (anneaux
 * compris) et morceaux avant et après la simplification Douglas-Peucker à `tolerance_m` (réglage en base), habitants de
 * la zone hors de la forme simplifiée (`perdue`) et habitants hors zone dedans (`gagnee`), seuil d'affichage de la perte.
 */
export interface MesureSimplification {
  tolerance_m: number;
  simplifiee: boolean;
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
