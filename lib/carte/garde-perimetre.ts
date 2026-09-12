/**
 * @file lib/carte/garde-perimetre.ts — garde-fou I/O Nano avant un calcul d'analyse
 *
 * Traduction directe de la spec §5 (Tâche 7, 2026-09-12) : le panneau Analyse
 * (Voronoï, bataille isochrone V1/V2) ne doit jamais lancer un calcul sans
 * périmètre borné — c'est exactement la famille de requêtes qui a épuisé le
 * budget I/O Supabase Nano le 28/03 et le 08/04 (voir CLAUDE.md « Incidents »).
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

/** Message affiché quand aucun périmètre n'est choisi — texte exact de la spec §5. */
export const MESSAGE_PERIMETRE_MANQUANT =
  'Choisissez un périmètre (filtre ou zone) avant de lancer un calcul.';

/** Un filtre actif OU une zone sélectionnée constituent un périmètre valide. */
export function perimetreChoisi(filtre: FiltreActif | null, zoneSelectionnee?: string | null): boolean {
  return filtre !== null || !!zoneSelectionnee;
}

/**
 * Message à afficher avant de bloquer un lancement, `null` si le calcul peut
 * continuer. Appeler AVANT tout lancement d'un outil d'analyse (Voronoï,
 * vérification/lancement de bataille isochrone V1 ou V2).
 */
export function messageGardePerimetre(filtre: FiltreActif | null, zoneSelectionnee?: string | null): string | null {
  return perimetreChoisi(filtre, zoneSelectionnee) ? null : MESSAGE_PERIMETRE_MANQUANT;
}
