import { inject } from '@angular/core';
import type { HttpInterceptorFn } from '@angular/common/http';
import { HttpErrorResponse } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { HttpBaseService } from './http-base.service';

/**
 * Une session qui se termine PENDANT une page (jeton de rafraîchissement
 * révoqué, cookie expiré) laissait l'utilisateur bloqué sur l'écran d'erreur
 * « Votre session a expiré » sans aucun moyen d'en sortir : le garde de route
 * (`authGuard`) ne s'exécute qu'À LA NAVIGATION, jamais sur une page déjà
 * ouverte. Un 401 sur l'API termine donc la session LOCALEMENT.
 *
 * Cet intercepteur ne NAVIGUE PAS : la session à null suffit.
 * `RacineDistanteComponent` en tire la conséquence — un message à la place
 * des pages, dans l'hôte comme en autonome (il n'y a plus de page de
 * connexion, 2026-11-05). Un seul endroit décide, pour les trois causes de
 * fin de session (401, `SIGNED_OUT` de GoTrue, déconnexion).
 * Pas de boucle de 401 : la racine retire ses pages, qui n'émettent donc plus
 * d'appel.
 *
 * SEULEMENT sur l'API (même périmètre que jetonInterceptor, après lequel cet
 * intercepteur est enregistré) : un 401 hors API n'a rien à voir avec la
 * session applicative.
 *
 * L'erreur est TOUJOURS relayée (`throwError`) : la page qui a émis l'appel
 * doit pouvoir résoudre son propre état d'échec (`versEtat`,
 * `EtatChargement`) plutôt que rester en chargement indéfini.
 */
export const sessionExpireeInterceptor: HttpInterceptorFn = (req, next) => {
  const apiUrl = inject(HttpBaseService).baseUrl;
  if (!req.url.startsWith(`${apiUrl}/`)) return next(req);
  const auth = inject(AuthService);
  return next(req).pipe(
    catchError((erreur: unknown) => {
      if (erreur instanceof HttpErrorResponse && erreur.status === 401) {
        void auth.deconnecter('locale');
      }
      return throwError(() => erreur);
    }),
  );
};
