/**
 * Transitions pures de la session de campagne (Tâche 15) — extraites pour
 * rester testables sans DOM. Deux transitions, deux intentions distinctes :
 * la bascule de vue ne touche QUE la vue (`appliquerBascule`) ; le
 * changement de campagne conserve les préférences de lecture (vue, maille)
 * mais efface le fil d'Ariane et la sélection, qui désignent des codes sans
 * garantie d'exister dans la nouvelle campagne (`appliquerChangementCampagne`).
 *
 * `CampagneSessionContext.basculerVue` APPELLE `appliquerBascule` depuis le
 * 2026-09-15 : il en répliquait la transformation (« compatibilité
 * historique »), soit deux écritures d'une même règle dont une seule était
 * testée — le motif que CLAUDE.md interdit pour les formateurs (`fmtNum`
 * × 15) et qui vaut tout autant pour une transition d'état. Ce fichier est la
 * source de vérité, et désormais la seule. `BarreContexteCampagne` (le
 * premier écrivain de `session.campaignId`, Tâche 15) appelle
 * `appliquerChangementCampagne` directement.
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
