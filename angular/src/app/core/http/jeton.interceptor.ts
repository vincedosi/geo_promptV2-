import { inject } from '@angular/core';
import type { HttpInterceptorFn } from '@angular/common/http';
import { from, switchMap } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { HttpBaseService } from './http-base.service';

/**
 * Pose `Authorization: Bearer` sur les appels à l'API, et SEULEMENT sur eux :
 * les routes lues par requireAuth() l'exigent. Les routes protégées par
 * middleware.ts lisent, elles, le cookie de session — posé par @supabase/ssr.
 */
export const jetonInterceptor: HttpInterceptorFn = (req, next) => {
  const apiUrl = inject(HttpBaseService).apiUrl;
  if (!req.url.startsWith(`${apiUrl}/`)) return next(req);
  const auth = inject(AuthService);
  return from(auth.jeton()).pipe(
    switchMap((jeton) =>
      next(jeton ? req.clone({ setHeaders: { Authorization: `Bearer ${jeton}` } }) : req),
    ),
  );
};
