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
 *
 * Round 2 (2026-09-15, spec-filtre-france.md) : le filtre `'france'` est un
 * filtre ACTIF (`filtre !== null`), mais il signifie « aucune restriction
 * géographique » — le PIÈGE de cette correction est inversé par rapport à
 * l'intuition. `bboxDuFiltre` réplique inconditionnellement sur `BBOX_METRO`
 * dès qu'un filtre n'a pas de bbox propre ; appliqué à `'france'`, cela
 * enverrait `BBOX_METRO` à CHAQUE requête de couche — plus restrictif que
 * l'absence de filtre d'avant cette tâche, et donc EXACTEMENT le même défaut
 * que celui documenté ci-dessus (POI/panneaux/couches d'outre-mer masqués).
 * `'france'` doit donc rendre `undefined`, au même titre qu'aucun filtre.
 */
import { bboxDuFiltre, type FiltreActif } from './filtre';

/**
 * Bbox [west, south, east, north] si un filtre géographiquement restrictif
 * est actif, sinon `undefined` — cas de l'absence de filtre ET du filtre
 * `'france'` (intention explicite de « pas de restriction »).
 */
export function bboxPourRequete(filtre: FiltreActif | null): readonly [number, number, number, number] | undefined {
  if (!filtre || filtre.type === 'france') return undefined;
  return bboxDuFiltre(filtre);
}
