import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { DemarrageService } from '../demarrage/demarrage.service';
import { MODE_DEVELOPPEMENT } from '../environnement/mode-developpement';
import { AuthService } from './auth.service';
import { ConnexionAutoService } from './connexion-auto.service';
import { STRATEGIE_SANS_SESSION } from './strategie-sans-session';

/**
 * Page protégée, sans session. **Ce garde ne redirige JAMAIS** : il n'y a
 * plus de page de connexion (décision du propriétaire, 2026-11-05 — AIDA
 * gère la session). Il laisse toujours passer ; les pages ne sont pas créées
 * pour autant — `RacineDistanteComponent` affiche un message à la place de
 * son `<router-outlet />`, et les montera sans renavigation quand la session
 * apparaîtra.
 *
 * Seule action : en lancement autonome (`STRATEGIE_AUTONOME`,
 * `connexionAuto`) ET en DÉVELOPPEMENT (`MODE_DEVELOPPEMENT`), il attend
 * d'abord la connexion automatique (`ConnexionAutoService`). Réussie, la page
 * demandée s'ouvre ; en échec (route 404 hors `next dev`, variables
 * `DEV_CONNEXION_AUTO_*` absentes ou refusées), la racine affiche
 * `MESSAGE_CONNEXION_AUTO_ECHOUEE`. Aucune connexion automatique dans un
 * hôte : AIDA fournit la session.
 *
 * `STRATEGIE_SANS_SESSION` est lue dans l'injecteur de LA ROUTE : c'est la
 * route `app` du lancement autonome qui fournit `connexionAuto`.
 *
 * Démarrage en échec : on laisse passer sans rien tenter — la racine affiche
 * l'erreur de démarrage, la vraie cause.
 *
 * Les dépendances sont toutes prises AVANT l'attente de la connexion auto :
 * un `inject()` après un `await` serait hors contexte (NG0203).
 */
export const authGuard: CanActivateFn = () => {
  if (inject(DemarrageService).erreur()) return true;
  if (inject(AuthService).connecte()) return true;
  if (!inject(STRATEGIE_SANS_SESSION).connexionAuto || !inject(MODE_DEVELOPPEMENT)) return true;
  return inject(ConnexionAutoService)
    .tenter()
    .then(() => true);
};
