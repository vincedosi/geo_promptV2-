import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { DemarrageService } from '../demarrage/demarrage.service';
import { MODE_DEVELOPPEMENT } from '../environnement/mode-developpement';
import { AuthService } from './auth.service';
import { ConnexionAutoService } from './connexion-auto.service';
import { STRATEGIE_SANS_SESSION } from './strategie-sans-session';

/**
 * Page protégée, sans session :
 * - lancement autonome (`rediriger`) : renvoie vers la page de connexion en
 *   gardant la cible. En DÉVELOPPEMENT (`MODE_DEVELOPPEMENT`) et si la
 *   stratégie porte `connexionAuto` (`STRATEGIE_AUTONOME`, 2026-11-02), tente
 *   d'abord la connexion automatique (`ConnexionAutoService`) : réussie, la
 *   page demandée s'ouvre sans écran ; en échec (route 404 hors `next dev`,
 *   variables `DEV_CONNEXION_AUTO_*` absentes), renvoi vers `/connexion`,
 *   qui reste le filet ;
 * - dans un hôte (`message`, défaut racine) : laisse passer. Les pages ne
 *   sont pas créées pour autant — `RacineDistanteComponent` affiche
 *   « Session requise… » à la place de son `<router-outlet />`, et les
 *   montera sans renavigation quand la session apparaîtra. Naviguer vers
 *   `/connexion` rendait un cadre vide : l'hôte n'a pas cette page (NG04002).
 *   Aucune connexion automatique dans un hôte : AIDA fournit la session.
 *
 * `STRATEGIE_SANS_SESSION` est lue dans l'injecteur de LA ROUTE : c'est la
 * route `app` du lancement autonome qui fournit `rediriger`.
 *
 * Démarrage en échec : on laisse passer — `RacineDistanteComponent` remplace
 * alors ses enfants par le message d'erreur, rien ne s'affiche dessous. Renvoyer
 * vers la connexion masquerait la vraie cause (« configuration introuvable »)
 * derrière un formulaire qui ne pourrait de toute façon pas fonctionner.
 *
 * Les dépendances sont toutes prises AVANT l'attente de la connexion auto :
 * un `inject()` après un `await` serait hors contexte (NG0203).
 */
export const authGuard: CanActivateFn = (_route, state) => {
  if (inject(DemarrageService).erreur()) return true;
  if (inject(AuthService).connecte()) return true;
  const strategie = inject(STRATEGIE_SANS_SESSION);
  if (strategie.mode === 'message') return true;
  const router = inject(Router);
  const versConnexion = () => router.createUrlTree([strategie.chemin], { queryParams: { redirection: state.url } });
  if (!strategie.connexionAuto || !inject(MODE_DEVELOPPEMENT)) return versConnexion();
  return inject(ConnexionAutoService)
    .tenter()
    .then((ok) => (ok ? true : versConnexion()));
};
