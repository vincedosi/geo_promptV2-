/**
 * Transitions pures de la session de campagne (Tâche 15) — extraites pour
 * rester testables sans DOM. Deux transitions, deux intentions distinctes :
 * la bascule de vue ne touche QUE la vue (`appliquerBascule`) ; le
 * changement de campagne conserve les préférences de lecture (vue, maille)
 * mais efface le fil d'Ariane et la sélection, qui désignent des codes sans
 * garantie d'exister dans la nouvelle campagne (`appliquerChangementCampagne`).
 *
 * `CampagneSessionContext.basculerVue` réplique la même transformation que
 * `appliquerBascule` (compatibilité historique) ; ce fichier en est la
 * source de vérité testée. `BarreContexteCampagne` (le premier écrivain de
 * `session.campaignId`, Tâche 15) appelle `appliquerChangementCampagne`
 * directement.
 */
import type { CampagneSession } from './session-types'

/** La bascule est un changement de VUE, pas une navigation : rien d'autre ne bouge. */
export function appliquerBascule(s: CampagneSession): CampagneSession {
  return { ...s, vue: s.vue === 'suivi' ? 'carte' : 'suivi' }
}

/**
 * Changer de campagne conserve la vue et la maille (préférences de lecture),
 * mais remet à zéro le fil d'Ariane et la sélection : ils désignent des codes
 * dont rien ne garantit qu'ils portent des données dans la nouvelle campagne.
 */
export function appliquerChangementCampagne(s: CampagneSession, campaignId: string): CampagneSession {
  return { ...s, campaignId, parent: null, uniteSelectionnee: null }
}
