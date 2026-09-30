import { InjectionToken } from '@angular/core';

/**
 * Où envoyer un utilisateur sans session. `/connexion` en lancement autonome.
 * ⚠ Dans AIDA, la connexion est peut-être assurée par le shell : question
 * posée au siège le 2026-09-30. Ce jeton est le seul point à changer.
 */
export const CHEMIN_CONNEXION = new InjectionToken<string>('CHEMIN_CONNEXION', {
  providedIn: 'root',
  factory: () => '/connexion',
});
