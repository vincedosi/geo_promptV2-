import { HttpErrorResponse } from '@angular/common/http';
import { messageErreurApi } from '../../../../core/http/erreurs';
import { MESSAGES_REFUS_COUVERTURE, type RefusCouverture } from './couverture';

/**
 * ④ Analyse — lire l'échec d'une demande de couverture (lot 4, T7). À part de `couverture.ts`, qui reste sans import
 * d'Angular pour le test de parité racine.
 */

/**
 * Le message d'un échec : la phrase que la route a écrite (`{ error }`, refus compris), sinon le message commun de
 * l'application ; réseau coupé (statut 0) : « Connexion perdue : réessayez. ».
 */
export function messageErreurCouverture(e: unknown): string {
  if (e instanceof HttpErrorResponse) {
    if (e.status === 0) return 'Connexion perdue : réessayez.';
    const corps = e.error as { error?: unknown } | null;
    if (corps && typeof corps === 'object' && typeof corps.error === 'string' && corps.error) return corps.error;
    return messageErreurApi(e);
  }
  return e instanceof Error ? e.message : 'Une erreur inattendue est survenue.';
}

/** Le refus porté par une réponse d'échec (`{ refus }`), ou `null`. */
export function refusDeLErreur(e: unknown): RefusCouverture | null {
  if (!(e instanceof HttpErrorResponse)) return null;
  const r = (e.error as { refus?: unknown } | null)?.refus;
  return typeof r === 'string' && r in MESSAGES_REFUS_COUVERTURE ? (r as RefusCouverture) : null;
}
