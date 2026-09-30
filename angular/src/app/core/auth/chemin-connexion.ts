import { InjectionToken } from '@angular/core';

/**
 * Où envoyer un utilisateur sans session, depuis le code PARTAGÉ par les deux
 * modes (`authGuard`, `AuthService.renvoyerVersConnexion`, la déconnexion de
 * la coquille). `/connexion` en lancement autonome.
 * ⚠ Dans AIDA, la connexion est peut-être assurée par le shell : question
 * posée au siège le 2026-09-30. Ce jeton est le point à changer pour ce code
 * partagé — mais PAS le seul chemin écrit en dur : `messages.ts`
 * (`'/connexion'`, `CIBLE_PAR_DEFAUT = '/app'`) et `sans-session.guard.ts`
 * (`'/app'`) en portent aussi. Ils ne servent que la page `/connexion`, qui
 * n'existe qu'en autonome (`appRoutes`) : ils sont justes dans ce mode, et
 * sans objet dans le shell tant que cette page n'y est pas montée.
 */
export const CHEMIN_CONNEXION = new InjectionToken<string>('CHEMIN_CONNEXION', {
  providedIn: 'root',
  factory: () => '/connexion',
});
