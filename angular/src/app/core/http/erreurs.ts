import { HttpErrorResponse } from '@angular/common/http';

/** Une phrase française pour l'écran, quelle que soit l'erreur. */
export function messageErreurApi(erreur: unknown): string {
  if (!(erreur instanceof HttpErrorResponse)) return 'Une erreur inattendue est survenue.';
  if (erreur.status === 0 || erreur.status === 502 || erreur.status === 504) {
    return 'L\'API ne répond pas. Le serveur Next.js (npm run dev, port 3000) est-il démarré ?';
  }
  if (erreur.status === 401) return 'Votre session a expiré. Reconnectez-vous.';
  if (erreur.status === 429) return 'Trop de demandes rapprochées. Réessayez dans une minute.';
  const corps = erreur.error as { error?: unknown } | null;
  if (corps && typeof corps.error === 'string' && corps.error) return corps.error;
  return 'Une erreur inattendue est survenue.';
}
