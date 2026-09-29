import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';

/** Page protégée : sans session, renvoie vers /connexion en gardant la cible. */
export const authGuard: CanActivateFn = (_route, state) => {
  if (inject(AuthService).connecte()) return true;
  return inject(Router).createUrlTree(['/connexion'], { queryParams: { redirection: state.url } });
};
