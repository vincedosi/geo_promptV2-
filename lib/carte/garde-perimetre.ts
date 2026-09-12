/**
 * @file lib/carte/garde-perimetre.ts — garde-fou I/O Nano avant un calcul d'analyse
 *
 * Traduction directe de la spec §5 (Tâche 7, 2026-09-12) : le panneau Analyse
 * ne doit jamais lancer un calcul sans périmètre borné — c'est exactement la
 * famille de requêtes qui a épuisé le budget I/O Supabase Nano le 28/03 et le
 * 08/04 (voir CLAUDE.md « Incidents »). La garde BLOQUE UN LANCEMENT, elle ne
 * paramètre rien : elle s'applique donc à tout outil qui déclenche un calcul,
 * que son API accepte ou non un filtre géographique en argument.
 *
 * Logique pure, testée sans monter React (tests/unit/carte/garde-perimetre.test.ts).
 *
 * Un périmètre est choisi si :
 *   - un `FiltreActif` est posé (lib/carte/filtre.ts) — quel que soit son type,
 *     y compris `zone` (une zone enregistrée sélectionnée dans PanneauFiltre
 *     compose déjà un `FiltreActif` de type `zone`) ; OU
 *   - une zone est sélectionnée par un identifiant qui ne transiterait pas par
 *     `FiltreActif` — second paramètre optionnel, pour ne pas braquer cette
 *     fonction sur la seule modélisation actuelle si une sélection de zone
 *     propre au panneau Analyse apparaît plus tard (Phase 2, Tâches 14-18).
 */
import type { FiltreActif } from './filtre';

/** Message affiché quand aucun périmètre n'est choisi — texte VERBATIM de la spec §5. */
export const MESSAGE_PERIMETRE_MANQUANT =
  'Choisissez un périmètre (filtre ou zone) avant de lancer un calcul';

/** Un filtre actif OU une zone sélectionnée constituent un périmètre valide. */
export function perimetreChoisi(filtre: FiltreActif | null, zoneSelectionnee?: string | null): boolean {
  return filtre !== null || !!zoneSelectionnee;
}

/**
 * Message à afficher avant de bloquer un lancement, `null` si le calcul peut
 * continuer. Appeler AVANT tout lancement d'un outil d'analyse.
 */
export function messageGardePerimetre(filtre: FiltreActif | null, zoneSelectionnee?: string | null): string | null {
  return perimetreChoisi(filtre, zoneSelectionnee) ? null : MESSAGE_PERIMETRE_MANQUANT;
}

/**
 * Les CINQ points de lancement du panneau Analyse (Tâche 7, round de
 * correction 1) — un calcul PostGIS/ORS ou une requête base de données sans
 * borne géographique, chacun capable de rejouer les incidents du 28/03 et du
 * 08/04 :
 *   - `voronoi`            : `VoronoiTool` → geo.prompt → RPC Voronoï
 *   - `battleV1`           : `IsochronesTool` → vérif. cache / remplissage
 *                             ORS / lancement de la bataille isochrone V1
 *   - `battleV2`           : `BattleV2Tool` → vérif. cache / remplissage ORS /
 *                             lancement de la bataille isochrone V2
 *   - `appliquerBataille`  : bouton « BATAILLE (ST_Difference) » d'`IsochronesTool`
 *                             (`onApplyBattle`) — un second point de calcul
 *                             PostGIS, distinct du lancement de la bataille
 *   - `clustering`         : `ClusteringSection` → `onLoadClusters`
 */
export type OutilAnalyse = 'voronoi' | 'battleV1' | 'battleV2' | 'appliquerBataille' | 'clustering';

const OUTILS_ANALYSE: readonly OutilAnalyse[] = [
  'voronoi', 'battleV1', 'battleV2', 'appliquerBataille', 'clustering',
];

/**
 * Pour un périmètre donné, dit quels lancements du panneau Analyse sont
 * autorisés — LES CINQ nommément, jamais une valeur unique qu'on suppose
 * partagée. Les cinq obéissent aujourd'hui à la MÊME règle (aucune variation
 * par outil : la garde ne regarde que le périmètre, pas l'outil), mais les
 * énumérer un par un est ce qui permet à un test de repérer l'oubli d'un
 * outil au prochain ajout — c'est précisément ce qui a laissé passer
 * `clustering` au premier passage de cette tâche.
 */
export function lancementsAutorises(
  filtre: FiltreActif | null,
  zoneSelectionnee?: string | null,
): Record<OutilAnalyse, boolean> {
  const autorise = perimetreChoisi(filtre, zoneSelectionnee);
  return Object.fromEntries(OUTILS_ANALYSE.map(outil => [outil, autorise])) as Record<OutilAnalyse, boolean>;
}
