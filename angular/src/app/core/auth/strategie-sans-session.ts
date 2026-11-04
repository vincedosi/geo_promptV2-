import { InjectionToken } from '@angular/core';

/**
 * Que faire quand l'utilisateur n'a pas (ou plus) de session.
 * - `message` : afficher « Session requise… » À LA PLACE des pages, sans
 *   naviguer. C'est le cas dans un hôte AIDA : il n'a pas de page
 *   `/connexion`, et y naviguer rendait un cadre vide (`NG04002`, épreuve du
 *   2026-09-30).
 * - `rediriger` : envoyer vers la page de connexion avec la page à reprendre.
 *   C'est le lancement autonome. Avec `connexionAuto`, `authGuard` tente
 *   d'abord la connexion automatique de développement (`ConnexionAutoService`,
 *   `/api/dev/connexion-auto`) — en mode développement seulement — et ne
 *   renvoie vers `chemin` que si elle échoue.
 */
export type StrategieSansSession =
  | { mode: 'message' }
  | { mode: 'rediriger'; chemin: string; connexionAuto?: boolean };

/**
 * ⚠ **Le défaut RACINE est `message`** : un hôte ne fournit rien, et c'est
 * dans l'hôte que la redirection est fausse. Le lancement autonome fournit
 * `rediriger` sur sa route `app` (`appRoutes`), dont `remoteRoutes` sont les
 * enfants — `authGuard`, la coquille et `RacineDistanteComponent` le lisent
 * donc dans l'injecteur de LEUR route. L'intercepteur de session expirée ne
 * le lit PAS : il met seulement fin à la session, et c'est
 * `RacineDistanteComponent` qui décide ensuite (message ou redirection).
 *
 * Rien de fourni `providedIn: 'root'` ne doit le lire : un service racine
 * verrait toujours le défaut. C'est pourquoi `AuthService` ne navigue plus.
 * La page `/connexion`, hors de la route `app`, ne le lit pas non plus : elle
 * n'existe qu'en autonome.
 */
export const STRATEGIE_SANS_SESSION = new InjectionToken<StrategieSansSession>('STRATEGIE_SANS_SESSION', {
  providedIn: 'root',
  factory: () => ({ mode: 'message' }),
});

/**
 * Le lancement autonome, fourni par la route `app` : connexion automatique de
 * développement d'abord (2026-11-02), page `/connexion` en repli. Un hôte AIDA
 * ne fournit jamais cette valeur — chez lui, rien ne change.
 */
export const STRATEGIE_AUTONOME: StrategieSansSession = { mode: 'rediriger', chemin: '/connexion', connexionAuto: true };

/** Le texte affiché sans session dans l'hôte. */
export const MESSAGE_SANS_SESSION = 'Session requise — connectez-vous à AIDA pour accéder à dentsu.explore.';
