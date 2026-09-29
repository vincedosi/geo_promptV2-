import { inject } from '@angular/core';
import type { HttpInterceptorFn } from '@angular/common/http';
import { defer, switchMap } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { HttpBaseService } from './http-base.service';

/**
 * Pose `Authorization: Bearer` sur les appels à l'API, et SEULEMENT sur eux :
 * les routes lues par requireAuth() l'exigent. Les routes protégées par
 * middleware.ts lisent, elles, le cookie de session — posé par @supabase/ssr.
 *
 * `defer(() => auth.jeton())` et non `from(auth.jeton())` : `from()` créerait
 * la promesse — donc figerait le jeton — au moment où la fonction
 * d'intercepteur s'exécute, une fois pour toutes. Si l'observable qu'elle
 * retourne est un jour ré-abonné par un retry SANS repasser par cette
 * fonction, `from()` rejouerait ce même jeton, potentiellement périmé.
 * `defer` relit `auth.jeton()` à chaque abonnement.
 */
export const jetonInterceptor: HttpInterceptorFn = (req, next) => {
  const apiUrl = inject(HttpBaseService).apiUrl;
  if (!req.url.startsWith(`${apiUrl}/`)) return next(req);
  const auth = inject(AuthService);
  return defer(() => auth.jeton()).pipe(
    switchMap((jeton) =>
      next(jeton ? req.clone({ setHeaders: { Authorization: `Bearer ${jeton}` } }) : req),
    ),
  );
};
