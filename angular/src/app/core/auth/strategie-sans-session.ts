import { InjectionToken } from '@angular/core';

/**
 * Que faire quand l'utilisateur n'a pas (ou plus) de session.
 * - `message` : afficher « Session requise… » À LA PLACE des pages, sans
 *   naviguer. C'est le cas dans un hôte AIDA : il n'a pas de page
 *   `/connexion`, et y naviguer rendait un cadre vide (`NG04002`, épreuve du
 *   2026-09-30).
 * - `rediriger` : envoyer vers la page de connexion avec la page à reprendre.
 *   C'est le lancement autonome.
 */
export type StrategieSansSession = { mode: 'message' } | { mode: 'rediriger'; chemin: string };

/**
 * ⚠ **Le défaut RACINE est `message`** : un hôte ne fournit rien, et c'est
 * dans l'hôte que la redirection est fausse. Le lancement autonome fournit
 * `rediriger` sur sa route `app` (`appRoutes`), dont `remoteRoutes` sont les
 * enfants — les gardes, l'intercepteur de session expirée, la coquille et
 * `RacineDistanteComponent` le lisent donc dans l'injecteur de LEUR route.
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

/** Le chemin de connexion du lancement autonome, fourni par la route `app`. */
export const STRATEGIE_AUTONOME: StrategieSansSession = { mode: 'rediriger', chemin: '/connexion' };

/** Le texte affiché sans session dans l'hôte. */
export const MESSAGE_SANS_SESSION = 'Session requise — connectez-vous à AIDA pour accéder à MAGELIAN.';
