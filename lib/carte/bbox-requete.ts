/**
 * @file lib/carte/bbox-requete.ts — bbox à envoyer à une requête de couche
 *
 * Round 1 de correction (Tâche 4, 2026-09-12) : la bbox ne part QUE si un
 * filtre est actif. Sans filtre, omettre le paramètre reproduit exactement
 * le comportement d'avant cette tâche (jamais de bbox par défaut) — un
 * premier essai appelait `bboxDuFiltre(filtre)` inconditionnellement, ce qui
 * repliait sur `BBOX_METRO` en permanence : 339 POI d'outre-mer masqués et
 * le pill « France + DROM » rendu inerte.
 *
 * `lib/carte/filtre.ts` reste inchangé (fichier protégé) : `bboxDuFiltre`
 * garde son repli sur `BBOX_METRO`, pour son cas propre — un filtre POSÉ dont
 * la bbox n'est pas encore résolue (région/département/commune/CP).
 */
import { bboxDuFiltre, type FiltreActif } from './filtre';

/** Bbox [west, south, east, north] si un filtre est actif, sinon `undefined`. */
export function bboxPourRequete(filtre: FiltreActif | null): readonly [number, number, number, number] | undefined {
  return filtre ? bboxDuFiltre(filtre) : undefined;
}
