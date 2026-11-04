import { InjectionToken } from '@angular/core';

/**
 * Que faire quand l'utilisateur n'a pas (ou plus) de session.
 *
 * Il n'y a PLUS de page de connexion (décision du propriétaire, 2026-11-05 :
 * « c'est AIDA qui va gérer ça »). Sans session, l'application affiche donc
 * toujours un message À LA PLACE des pages, sans naviguer — dans l'hôte AIDA
 * comme en lancement autonome. La seule différence :
 * - `connexionAuto: true` (lancement autonome, `STRATEGIE_AUTONOME`) :
 *   `authGuard` tente d'abord la connexion automatique de développement
 *   (`ConnexionAutoService`, `/api/dev/connexion-auto`) — en mode
 *   développement seulement. C'est le SEUL moyen d'ouvrir l'app en local hors
 *   AIDA ; en échec, `RacineDistanteComponent` dit de vérifier
 *   `DEV_CONNEXION_AUTO_*`.
 * - `connexionAuto: false` (hôte AIDA, défaut racine) : le shell fournit la
 *   session, rien n'est tenté.
 */
export interface StrategieSansSession {
  readonly connexionAuto: boolean;
}

/**
 * ⚠ **Le défaut RACINE est « sans connexion automatique »** : un hôte ne
 * fournit rien. Le lancement autonome fournit `STRATEGIE_AUTONOME` sur sa
 * route `app` (`appRoutes`), dont `remoteRoutes` sont les enfants —
 * `authGuard` et `RacineDistanteComponent` le lisent donc dans l'injecteur de
 * LEUR route. Rien de fourni `providedIn: 'root'` ne doit le lire : un service
 * racine verrait toujours le défaut.
 */
export const STRATEGIE_SANS_SESSION = new InjectionToken<StrategieSansSession>('STRATEGIE_SANS_SESSION', {
  providedIn: 'root',
  factory: () => ({ connexionAuto: false }),
});

/** Le lancement autonome, fourni par la route `app` : connexion automatique de développement (2026-11-02). */
export const STRATEGIE_AUTONOME: StrategieSansSession = { connexionAuto: true };

/** Le texte affiché sans session dans l'hôte (et en autonome hors développement). */
export const MESSAGE_SANS_SESSION = 'Session requise — connectez-vous à AIDA pour accéder à dentsu.explore.';

/** Lancement autonome en développement : la connexion automatique a échoué (404, identifiants refusés…). */
export const MESSAGE_CONNEXION_AUTO_ECHOUEE =
  'Connexion automatique impossible — vérifiez DEV_CONNEXION_AUTO_EMAIL et DEV_CONNEXION_AUTO_MOT_DE_PASSE '
  + 'dans .env.development.local, que l’API tourne sous « npm run dev », puis rechargez la page.';

/** Lancement autonome en développement : session fermée (déconnexion, 401) — un rechargement la rouvre. */
export const MESSAGE_SESSION_FERMEE_LOCALE =
  'Session fermée — rechargez la page pour rouvrir la connexion automatique de développement.';
