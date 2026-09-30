import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { DemarrageService } from '../demarrage/demarrage.service';
import { AuthService } from './auth.service';
import { CHEMIN_CONNEXION } from './chemin-connexion';

/**
 * Page protégée : sans session, renvoie vers la page de connexion en gardant la cible.
 *
 * Démarrage en échec : on laisse passer — `RacineDistanteComponent` remplace
 * alors ses enfants par le message d'erreur, rien ne s'affiche dessous. Renvoyer
 * vers la connexion masquerait la vraie cause (« configuration introuvable »)
 * derrière un formulaire qui ne pourrait de toute façon pas fonctionner.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  if (inject(DemarrageService).erreur()) return true;
  if (inject(AuthService).connecte()) return true;
  return inject(Router).createUrlTree([inject(CHEMIN_CONNEXION)], { queryParams: { redirection: state.url } });
};
